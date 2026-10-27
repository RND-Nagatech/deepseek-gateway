import { FormEvent, ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import QRCode from 'qrcode';
import { CostChart } from './components/CostChart';
import { Icon, IconName } from './components/Icon';
import { UsageTable } from './components/UsageTable';
import { ApiError, apiRequest, checkHealth } from './lib/api';
import { formatDate, formatNumber, formatRupiah, formatRupiahBalance } from './lib/format';
import { Client, Health, Overview, Pricing, SingaPayVaBankCode, TopUp, TopUpMethod, TopUpStatus, UsageRow, View } from './types';

const navigation: Array<{ id: View; label: string; icon: IconName }> = [
  { id: 'overview', label: 'Ringkasan', icon: 'overview' },
  { id: 'clients', label: 'Client & key', icon: 'clients' },
  { id: 'usage', label: 'Riwayat request', icon: 'usage' },
  { id: 'pricing', label: 'Tarif', icon: 'pricing' },
];

type ModalState =
  | { mode: 'new-client' }
  | { mode: 'add-key'; client: Client }
  | { mode: 'rename-client'; client: Client }
  | { mode: 'revoke-key'; client: Client; keyId: string }
  | { mode: 'top-up'; client: Client; key: Client['keys'][number] }
  | { mode: 'manual-top-up'; client: Client; key: Client['keys'][number] }
  | null;

const activeTopUpStatuses: TopUpStatus[] = ['creating', 'pending', 'needs_review'];
const reconcilableTopUpStatuses: TopUpStatus[] = [...activeTopUpStatuses, 'expired', 'failed'];
const vaBanks: Array<{ code: SingaPayVaBankCode; label: string }> = [
  { code: 'BCA', label: 'BCA' },
  { code: 'BNI', label: 'BNI' },
  { code: 'BRI', label: 'BRI' },
  { code: 'MANDIRI', label: 'Mandiri' },
  { code: 'PERMATA', label: 'Permata' },
  { code: 'MAYBANK', label: 'Maybank' },
  { code: 'CIMB', label: 'CIMB Niaga' },
  { code: 'BSI', label: 'BSI' },
  { code: 'MUAMALAT', label: 'Bank Muamalat' },
  { code: 'BNC', label: 'BNC' },
  { code: 'OCBC', label: 'OCBC' },
  { code: 'DANAMON', label: 'Danamon' },
];

export function App() {
  const [adminToken, setAdminToken] = useState('');
  const [authenticated, setAuthenticated] = useState(false);
  const [loginValue, setLoginValue] = useState('local-dev-token');
  const [loginError, setLoginError] = useState('');
  const [health, setHealth] = useState<Health | null>(null);
  const [view, setView] = useState<View>('overview');
  const [days, setDays] = useState(30);
  const [overview, setOverview] = useState<Overview | null>(null);
  const [clients, setClients] = useState<Client[]>([]);
  const [usage, setUsage] = useState<UsageRow[]>([]);
  const [pricing, setPricing] = useState<Pricing | null>(null);
  const [pageError, setPageError] = useState('');
  const [notice, setNotice] = useState('');
  const [loading, setLoading] = useState(false);
  const [modal, setModal] = useState<ModalState>(null);
  const [clientName, setClientName] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [topUpAmount, setTopUpAmount] = useState('');
  const [topUpMethod, setTopUpMethod] = useState<TopUpMethod>('va');
  const [topUpBankCode, setTopUpBankCode] = useState<SingaPayVaBankCode>('BCA');
  const [manualTopUpReason, setManualTopUpReason] = useState('');
  const [topUpPayment, setTopUpPayment] = useState<TopUp | null>(null);
  const [topUpError, setTopUpError] = useState('');
  const [topUpIdempotencyKey, setTopUpIdempotencyKey] = useState('');
  const [existingTopUpLoading, setExistingTopUpLoading] = useState(false);
  const [showKey, setShowKey] = useState(false);
  const [expandedClient, setExpandedClient] = useState<string | null>(null);
  const [usageClientFilter, setUsageClientFilter] = useState('all');
  const [usageSearch, setUsageSearch] = useState('');
  const [priceInput, setPriceInput] = useState('50000');
  const dialogRef = useRef<HTMLElement | null>(null);
  const modalTriggerRef = useRef<HTMLElement | null>(null);

  function openModal(nextModal: Exclude<ModalState, null>) {
    modalTriggerRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setClientName(nextModal.mode === 'rename-client' ? nextModal.client.name : '');
    setApiKey('');
    setTopUpAmount('');
    setTopUpMethod('va');
    setTopUpBankCode('BCA');
    setManualTopUpReason('');
    setTopUpPayment(null);
    setTopUpError('');
    setExistingTopUpLoading(nextModal.mode === 'top-up');
    setTopUpIdempotencyKey(nextModal.mode === 'top-up' ? crypto.randomUUID() : '');
    setShowKey(false);
    setModal(nextModal);
  }

  function closeModal() {
    setModal(null);
    setClientName('');
    setApiKey('');
    setTopUpAmount('');
    setTopUpMethod('va');
    setTopUpBankCode('BCA');
    setManualTopUpReason('');
    setTopUpPayment(null);
    setTopUpError('');
    setExistingTopUpLoading(false);
    setTopUpIdempotencyKey('');
    setShowKey(false);
    window.requestAnimationFrame(() => modalTriggerRef.current?.focus());
  }

  useEffect(() => {
    if (!modal) return;
    function keepModalKeyboardAccessible(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        event.preventDefault();
        closeModal();
        return;
      }
      if (event.key !== 'Tab') return;
      const controls = dialogRef.current?.querySelectorAll<HTMLElement>(
        'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])',
      );
      if (!controls?.length) return;
      const first = controls[0];
      const last = controls[controls.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }
    window.addEventListener('keydown', keepModalKeyboardAccessible);
    return () => window.removeEventListener('keydown', keepModalKeyboardAccessible);
  }, [modal]);

  async function fetchAll(token: string, period = days) {
    const [overviewData, clientData, usageData, pricingData] = await Promise.all([
      apiRequest<Overview>(`/overview?days=${period}`, token),
      apiRequest<Client[]>('/clients', token),
      apiRequest<UsageRow[]>('/usage?limit=100', token),
      apiRequest<Pricing>('/pricing', token),
    ]);
    setOverview(overviewData);
    setClients(clientData);
    setUsage(usageData);
    setPricing(pricingData);
    setPriceInput(String(pricingData.pricePerMillionIdr));
  }

  async function authorize(candidate: string, persist = true) {
    setLoading(true);
    setLoginError('');
    try {
      await fetchAll(candidate);
      setAdminToken(candidate);
      setAuthenticated(true);
      if (persist) sessionStorage.setItem('deepseek-monitor-admin-token', candidate);
    } catch (error) {
      setLoginError(error instanceof Error ? error.message : 'Token admin tidak dapat digunakan.');
      setAuthenticated(false);
      sessionStorage.removeItem('deepseek-monitor-admin-token');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void checkHealth()
      .then((result: Health) => setHealth(result))
      .catch(() => setHealth({ status: 'degraded', mongodb: 'disconnected', time: new Date().toISOString() }));
    const savedToken = sessionStorage.getItem('deepseek-monitor-admin-token');
    if (savedToken) void authorize(savedToken, false);
  }, []);

  useEffect(() => {
    if (!authenticated) return;
    const timer = window.setInterval(() => {
      void apiRequest<Overview>(`/overview?days=${days}`, adminToken)
        .then(setOverview)
        .catch((error: unknown) => setPageError(error instanceof Error ? error.message : 'Pembaruan gagal.'));
    }, 30_000);
    return () => window.clearInterval(timer);
  }, [authenticated, adminToken, days]);

  useEffect(() => {
    if (!authenticated) return;
    void apiRequest<Overview>(`/overview?days=${days}`, adminToken)
      .then(setOverview)
      .catch((error: unknown) => setPageError(error instanceof Error ? error.message : 'Rentang waktu tidak dapat dimuat.'));
  }, [days]);

  useEffect(() => {
    if (!authenticated || modal?.mode !== 'top-up') return;
    let cancelled = false;
    setExistingTopUpLoading(true);
    apiRequest<TopUp>(
      `/clients/${modal.client.id}/keys/${modal.key.id}/topups/active`,
      adminToken,
    )
      .then((topUp) => {
        if (!cancelled) {
          setTopUpPayment(topUp);
          setTopUpAmount(String(topUp.amountIdr));
          setTopUpMethod(topUp.method);
          if (topUp.bankCode) setTopUpBankCode(topUp.bankCode);
        }
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        if (error instanceof ApiError && error.status === 404) {
          setTopUpPayment(null);
          return;
        }
        setPageError(error instanceof Error ? error.message : 'Status top-up tidak dapat dimuat.');
      })
      .finally(() => { if (!cancelled) setExistingTopUpLoading(false); });
    return () => { cancelled = true; };
  }, [authenticated, adminToken, modal]);

  useEffect(() => {
    if (!authenticated || modal?.mode !== 'top-up' || !topUpPayment?.merchantRef
      || !activeTopUpStatuses.includes(topUpPayment.status)) return;

    const client = modal.client;
    const key = modal.key;
    const merchantRef = topUpPayment.merchantRef;
    const timer = window.setInterval(() => {
      void apiRequest<TopUp>(
        `/clients/${client.id}/keys/${key.id}/topups/${merchantRef}`,
        adminToken,
      )
        .then((nextTopUp) => {
          setTopUpPayment(nextTopUp);
          if (nextTopUp.status === 'paid') {
            void apiRequest<Client[]>('/clients', adminToken).then(setClients).catch(() => undefined);
            flash(`${formatRupiah(nextTopUp.amountIdr)} masuk ke saldo key.`);
          }
        })
        .catch((error: unknown) => setPageError(error instanceof Error ? error.message : 'Status pembayaran tidak dapat diperbarui.'));
    }, 5000);
    return () => window.clearInterval(timer);
  }, [authenticated, adminToken, modal, topUpPayment?.merchantRef, topUpPayment?.status]);

  useEffect(() => {
    if (pricing) setPriceInput(String(pricing.pricePerMillionIdr));
  }, [pricing]);

  const filteredUsage = useMemo(() => {
    const query = usageSearch.trim().toLocaleLowerCase('id-ID');
    return usage.filter((row) => {
      const clientMatch = usageClientFilter === 'all' || row.clientId === usageClientFilter;
      const searchMatch = !query || [row.clientName, row.model, row.path, row.method]
        .some((value) => String(value ?? '').toLocaleLowerCase('id-ID').includes(query));
      return clientMatch && searchMatch;
    });
  }, [usage, usageClientFilter, usageSearch]);

  async function refreshAll() {
    setPageError('');
    try {
      await fetchAll(adminToken);
    } catch (error) {
      setPageError(error instanceof Error ? error.message : 'Data belum dapat dimuat.');
    }
  }

  function flash(message: string) {
    setNotice(message);
    window.setTimeout(() => setNotice(''), 3000);
  }

  async function recoverTopUpState(client: Client, key: Client['keys'][number]) {
    try {
      const activeTopUp = await apiRequest<TopUp>(
        `/clients/${client.id}/keys/${key.id}/topups/active`,
        adminToken,
      );
      setTopUpPayment(activeTopUp);
      setTopUpAmount(String(activeTopUp.amountIdr));
      setTopUpMethod(activeTopUp.method);
      if (activeTopUp.bankCode) setTopUpBankCode(activeTopUp.bankCode);
    } catch (error) {
      if (error instanceof ApiError && error.status === 404) {
        setTopUpPayment(null);
        setTopUpIdempotencyKey(crypto.randomUUID());
        return;
      }
      throw error;
    }
  }

  async function submitClient(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const currentModal = modal;
    if (!currentModal) return;
    if (currentModal.mode === 'new-client' && (!clientName.trim() || !apiKey.trim())) return;
    if (currentModal.mode === 'add-key' && !apiKey.trim()) return;
    if (currentModal.mode === 'rename-client' && !clientName.trim()) return;
    const minimumTopUpIdr = currentModal.mode === 'top-up' && topUpMethod === 'va' ? 10_000 : 1;
    if ((currentModal.mode === 'top-up' || currentModal.mode === 'manual-top-up')
      && (!Number.isSafeInteger(Number(topUpAmount)) || Number(topUpAmount) < minimumTopUpIdr || Number(topUpAmount) > 1_000_000_000)) return;
    if (currentModal.mode === 'manual-top-up' && !manualTopUpReason.trim()) return;
    setLoading(true);
    setPageError('');
    if (currentModal.mode === 'top-up') setTopUpError('');
    try {
      if (currentModal.mode === 'new-client') {
        await apiRequest('/clients', adminToken, {
          method: 'POST',
          body: JSON.stringify({ name: clientName, apiKey }),
        });
        flash(`Client ${clientName.trim()} berhasil ditambahkan.`);
      } else if (currentModal.mode === 'add-key') {
        await apiRequest(`/clients/${currentModal.client.id}/keys`, adminToken, {
          method: 'POST',
          body: JSON.stringify({ apiKey }),
        });
        flash('API key berhasil dipasangkan.');
      } else if (currentModal.mode === 'rename-client') {
        await apiRequest(`/clients/${currentModal.client.id}`, adminToken, {
          method: 'PATCH',
          body: JSON.stringify({ name: clientName.trim() }),
        });
        flash('Nama client diperbarui.');
      } else if (currentModal.mode === 'revoke-key') {
        await apiRequest(`/clients/${currentModal.client.id}/keys/${currentModal.keyId}/revoke`, adminToken, { method: 'PATCH' });
        flash('API key dicabut.');
      } else if (currentModal.mode === 'top-up') {
        const amountIdr = Number(topUpAmount);
        const isVa = topUpMethod === 'va';
        const payment = await apiRequest<TopUp>(`/clients/${currentModal.client.id}/keys/${currentModal.key.id}/${isVa ? 'va' : 'qris'}-topups`, adminToken, {
          method: 'POST',
          headers: { 'Idempotency-Key': topUpIdempotencyKey },
          body: JSON.stringify({ amountIdr, ...(isVa ? { bankCode: topUpBankCode } : {}) }),
        });
        setTopUpPayment(payment);
        setTopUpAmount(String(amountIdr));
        setTopUpMethod(payment.method);
        flash(payment.status === 'paid'
          ? `${formatRupiah(amountIdr)} masuk ke saldo ${currentModal.key.keyHint}.`
          : `${payment.method === 'va' ? 'Virtual Account' : 'QRIS'} siap. Saldo bertambah setelah pembayaran dikonfirmasi.`);
        await refreshAll();
        return;
      } else {
        const amountIdr = Number(topUpAmount);
        await apiRequest(`/clients/${currentModal.client.id}/keys/${currentModal.key.id}/topups`, adminToken, {
          method: 'POST',
          body: JSON.stringify({ amountIdr, reason: manualTopUpReason.trim() }),
        });
        flash(`${formatRupiah(amountIdr)} ditambahkan secara manual ke saldo ${currentModal.key.keyHint}.`);
      }
      closeModal();
      await refreshAll();
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Perubahan tidak dapat disimpan.';
      if (currentModal.mode === 'top-up') {
        setTopUpError(message);
        try {
          await recoverTopUpState(currentModal.client, currentModal.key);
        } catch {
          // Keep the original payment error visible when the status lookup also fails.
        }
      } else {
        setPageError(message);
      }
    } finally {
      setLoading(false);
    }
  }

  async function renameClient(client: Client) {
    openModal({ mode: 'rename-client', client });
  }

  async function reconcileTopUp(client: Client, key: Client['keys'][number], merchantRef: string) {
    setLoading(true);
    setTopUpError('');
    try {
      const result = await apiRequest<TopUp>(
        `/clients/${client.id}/keys/${key.id}/topups/${merchantRef}/reconcile`,
        adminToken,
        { method: 'POST' },
      );
      setTopUpPayment(result);
      if (result.status === 'paid') {
        await apiRequest<Client[]>('/clients', adminToken).then(setClients);
        flash(`${formatRupiah(result.amountIdr)} masuk ke saldo key.`);
      } else if (result.status === 'expired') {
        flash(`${result.method === 'va' ? 'VA' : 'QRIS'} kedaluwarsa. Periksa dan buat pembayaran baru dari panel.`);
      } else if (result.status === 'needs_review') {
        flash('Status belum pasti. Gunakan tombol pemulihan QR setelah pemeriksaan ini.');
      } else {
        flash('Status pembayaran sudah diperiksa.');
      }
    } catch (error) {
      setTopUpError(error instanceof Error ? error.message : 'Status pembayaran tidak dapat diperiksa.');
    } finally {
      setLoading(false);
    }
  }

  async function retryTopUp(client: Client, key: Client['keys'][number], topUp: TopUp) {
    if (!topUp.merchantRef) return;
    const paymentLabel = topUp.method === 'va' ? 'VA' : 'QRIS';
    const confirmed = window.confirm(
      `Gateway akan memeriksa transaksi ${paymentLabel} ini ke SingaPay. Jika pembayaran lama masih berlaku, datanya akan ditampilkan. Jika pencarian lengkap memastikan transaksi lama tidak dapat dipakai, ${paymentLabel} pengganti dibuat. Pembayaran lama yang masuk belakangan tetap dapat menambah saldo. Lanjutkan?`,
    );
    if (!confirmed) return;

    setLoading(true);
    setTopUpError('');
    try {
      const result = await apiRequest<TopUp>(
        `/clients/${client.id}/keys/${key.id}/topups/${topUp.merchantRef}/retry`,
        adminToken,
        { method: 'POST', headers: { 'Idempotency-Key': crypto.randomUUID() } },
      );
      setTopUpPayment(result);
      setTopUpAmount(String(result.amountIdr));
      if (result.status === 'paid') {
        await apiRequest<Client[]>('/clients', adminToken).then(setClients);
        flash(`${formatRupiah(result.amountIdr)} masuk ke saldo key.`);
      } else if ((result.qrData || result.vaNumber) && result.status === 'pending') {
        flash(result.method === 'va' ? 'Nomor Virtual Account tersedia untuk dibayar.' : 'QRIS tersedia untuk dipindai.');
      } else {
        flash('Status pembayaran diperbarui. Ikuti petunjuk pada panel pembayaran.');
      }
    } catch (error) {
      setTopUpError(error instanceof Error ? error.message : 'Pembayaran belum dapat dipulihkan.');
      try {
        await recoverTopUpState(client, key);
      } catch {
        // Keep the retry error visible if the status lookup also fails.
      }
    } finally {
      setLoading(false);
    }
  }

  async function toggleClient(client: Client) {
    const status = client.status === 'active' ? 'paused' : 'active';
    try {
      await apiRequest(`/clients/${client.id}/status`, adminToken, { method: 'PATCH', body: JSON.stringify({ status }) });
      flash(status === 'active' ? 'Client diaktifkan.' : 'Client dijeda. Key-nya tidak lagi dapat melewati gateway.');
      await refreshAll();
    } catch (error) {
      setPageError(error instanceof Error ? error.message : 'Status client tidak dapat diubah.');
    }
  }

  async function revokeKey(client: Client, keyId: string) {
    openModal({ mode: 'revoke-key', client, keyId });
  }

  async function savePricing(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const pricePerMillionIdr = Number(priceInput);
    if (!Number.isSafeInteger(pricePerMillionIdr) || pricePerMillionIdr < 0) {
      setPageError('Tarif harus berupa bilangan rupiah bulat dan tidak boleh negatif.');
      return;
    }
    setLoading(true);
    setPageError('');
    try {
      const updated = await apiRequest<Pricing>('/pricing', adminToken, {
        method: 'PUT',
        body: JSON.stringify({ pricePerMillionIdr }),
      });
      setPricing(updated);
      flash('Tarif baru tersimpan. Tarif ini berlaku untuk request berikutnya.');
    } catch (error) {
      setPageError(error instanceof Error ? error.message : 'Tarif tidak dapat disimpan.');
    } finally {
      setLoading(false);
    }
  }

  function signOut() {
    sessionStorage.removeItem('deepseek-monitor-admin-token');
    setAuthenticated(false);
    setAdminToken('');
  }

  if (!authenticated) {
    return (
      <LoginScreen
        health={health}
        value={loginValue}
        error={loginError}
        loading={loading}
        onChange={setLoginValue}
        onSubmit={(event) => { event.preventDefault(); void authorize(loginValue.trim()); }}
      />
    );
  }

  const title = navigation.find((item) => item.id === view)?.label ?? 'Ringkasan';
  const gatewayReady = health?.status === 'ok';
  const modalNeedsName = modal?.mode === 'new-client' || modal?.mode === 'rename-client';
  const modalNeedsKey = modal?.mode === 'new-client' || modal?.mode === 'add-key';
  const modalNeedsAmount = modal?.mode === 'top-up' || modal?.mode === 'manual-top-up';
  const topUpMinimum = modal?.mode === 'top-up' && topUpMethod === 'va' ? 10_000 : 1;
  const modalTitle = modal?.mode === 'new-client'
    ? 'Daftarkan client'
    : modal?.mode === 'add-key'
      ? 'Tambahkan API key'
      : modal?.mode === 'rename-client'
        ? 'Ubah nama client'
        : modal?.mode === 'revoke-key'
          ? 'Cabut API key'
          : modal?.mode === 'manual-top-up'
            ? 'Penyesuaian saldo'
            : topUpPayment
              ? `Pembayaran ${topUpPayment.method === 'va' ? 'Virtual Account' : 'QRIS'}`
              : 'Isi saldo key';
  const modalDescription = modal?.mode === 'new-client'
    ? 'Pasangkan key DeepSeek yang sudah digunakan client.'
    : modal?.mode === 'add-key'
      ? `Simpan key lain untuk ${modal.client.name}.`
      : modal?.mode === 'rename-client'
        ? 'Gunakan nama yang mudah dikenali di riwayat penggunaan.'
        : modal?.mode === 'revoke-key'
          ? `Cabut key milik ${modal.client.name}. Request berikutnya dengan key ini akan ditolak.`
          : modal?.mode === 'top-up'
            ? `Pilih metode pembayaran untuk key ${modal.key.keyHint} milik ${modal.client.name}. Saldo masuk setelah SingaPay mengonfirmasi pembayaran.`
            : modal?.mode === 'manual-top-up'
              ? `Catat penyesuaian langsung pada saldo key ${modal.key.keyHint} milik ${modal.client.name}.`
            : '';

  return (
    <div className="app-frame">
      <aside className="sidebar">
        <div className="brand-lockup">
          <div className="brand-glyph" aria-hidden="true"><span /><span /><span /></div>
          <div><strong>DeepSeek</strong><span>Monitor</span></div>
        </div>
        <div className="workspace-label">Workspace</div>
        <nav className="side-nav" aria-label="Navigasi utama">
          {navigation.map((item) => (
            <button
              className={`nav-item ${view === item.id ? 'nav-item-active' : ''}`}
              key={item.id}
              type="button"
              onClick={() => setView(item.id)}
              aria-current={view === item.id ? 'page' : undefined}
            >
              <Icon name={item.icon} size={18} />
              <span>{item.label}</span>
              {item.id === 'clients' && clients.length > 0 && <small>{clients.length}</small>}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className={`db-status ${health?.mongodb === 'connected' ? 'db-status-ready' : 'db-status-down'}`}>
            <Icon name="database" size={16} />
            <div><strong>MongoDB lokal</strong><span>{health?.mongodb === 'connected' ? 'Terhubung' : 'Tidak terhubung'}</span></div>
            <i aria-hidden="true" />
          </div>
          <button className="sign-out" type="button" onClick={signOut}>Kunci dashboard</button>
        </div>
      </aside>

      <div className="main-column">
        <header className="topbar">
          <div className="topbar-crumb"><span>DeepSeek Monitor</span><b>/</b><strong>{title}</strong></div>
          <div className="topbar-actions">
            <span className={`gateway-state ${gatewayReady ? 'gateway-state-up' : 'gateway-state-down'}`}><i />{gatewayReady ? 'Gateway aktif' : health ? 'Gateway terputus' : 'Memeriksa gateway'}</span>
            <button className="icon-button" type="button" aria-label="Muat ulang data" onClick={() => void refreshAll()}>
              <Icon name="refresh" size={17} />
            </button>
          </div>
        </header>

        <main className="page-content">
          {pageError && <div className="notice notice-error" role="alert"><Icon name="warning" size={16} /><span>{pageError}</span><button type="button" onClick={() => setPageError('')} aria-label="Tutup pesan"><Icon name="close" size={15} /></button></div>}
          {notice && <div className="notice notice-success" role="status"><Icon name="check" size={16} />{notice}</div>}

          {view === 'overview' && overview && (
            <OverviewPage
              overview={overview}
              clients={clients}
              pricing={pricing}
              days={days}
              setDays={setDays}
              onAdd={() => openModal({ mode: 'new-client' })}
              onNavigate={setView}
            />
          )}

          {view === 'clients' && (
            <ClientsPage
              clients={clients}
              onAdd={() => openModal({ mode: 'new-client' })}
              onAddKey={(client) => openModal({ mode: 'add-key', client })}
              onTopUp={(client, key) => openModal({ mode: 'top-up', client, key })}
              onManualTopUp={(client, key) => openModal({ mode: 'manual-top-up', client, key })}
              onRename={(client) => void renameClient(client)}
              onToggle={(client) => void toggleClient(client)}
              onRevoke={(client, keyId) => void revokeKey(client, keyId)}
              expanded={expandedClient}
              onExpand={(id) => setExpandedClient(expandedClient === id ? null : id)}
            />
          )}

          {view === 'usage' && (
            <UsagePage
              clients={clients}
              rows={filteredUsage}
              clientId={usageClientFilter}
              search={usageSearch}
              onClientChange={setUsageClientFilter}
              onSearchChange={setUsageSearch}
            />
          )}

          {view === 'pricing' && (
            <PricingPage
              pricing={pricing}
              value={priceInput}
              loading={loading}
              onChange={setPriceInput}
              onSubmit={(event) => void savePricing(event)}
            />
          )}
        </main>
      </div>

      {modal && (
        <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) closeModal(); }}>
            <section className="modal-panel" ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="client-modal-title" aria-describedby="client-modal-description">
            <div className="modal-head">
              <div><span className="modal-mark"><Icon name={modal.mode === 'rename-client' ? 'clients' : modal.mode === 'top-up' || modal.mode === 'manual-top-up' ? 'wallet' : 'key'} size={18} /></span><div><h2 id="client-modal-title">{modalTitle}</h2><p id="client-modal-description">{modalDescription}</p></div></div>
              <button className="icon-button" type="button" aria-label="Tutup" autoFocus={modal.mode === 'revoke-key'} onClick={closeModal}><Icon name="close" size={18} /></button>
            </div>
            <form className="modal-form" onSubmit={(event) => void submitClient(event)}>
              {modal.mode === 'top-up' && topUpError && <div className="notice notice-error topup-error" role="alert"><Icon name="warning" size={16} /><span>{topUpError}</span><button type="button" onClick={() => setTopUpError('')} aria-label="Tutup pesan"><Icon name="close" size={15} /></button></div>}
              {modalNeedsName && <label>{modal.mode === 'rename-client' ? 'Nama client baru' : 'Nama client'}<input autoFocus autoComplete="off" maxLength={80} required value={clientName} onChange={(event) => setClientName(event.target.value)} placeholder="Contoh: Layanan pencarian" /></label>}
              {modalNeedsKey && <label>API key DeepSeek
                <div className="password-field"><input autoFocus={modal.mode === 'add-key'} autoComplete="new-password" required minLength={12} type={showKey ? 'text' : 'password'} value={apiKey} onChange={(event) => setApiKey(event.target.value)} placeholder="Tempel key yang digunakan client" /><button type="button" onClick={() => setShowKey(!showKey)}>{showKey ? 'Sembunyikan' : 'Tampilkan'}</button></div>
              </label>}
              {modalNeedsAmount && modal.mode === 'top-up' && topUpPayment && <TopUpPaymentPanel
                topUp={topUpPayment}
                loading={loading}
                onRetry={() => void retryTopUp(modal.client, modal.key, topUpPayment)}
                onReconcile={() => {
                  if (topUpPayment.merchantRef) {
                    void reconcileTopUp(modal.client, modal.key, topUpPayment.merchantRef);
                  }
                }}
              />}
              {modalNeedsAmount && modal.mode === 'top-up' && !topUpPayment && existingTopUpLoading && <div className="payment-loading" role="status">Memeriksa pembayaran yang masih perlu ditangani…</div>}
              {modal.mode === 'top-up' && !topUpPayment && !existingTopUpLoading && <label>Metode pembayaran
                <select value={topUpMethod} onChange={(event) => setTopUpMethod(event.target.value as TopUpMethod)}>
                  <option value="va">Virtual Account</option>
                  <option value="qris">QRIS</option>
                </select>
              </label>}
              {modal.mode === 'top-up' && !topUpPayment && !existingTopUpLoading && topUpMethod === 'va' && <label>Bank penerima
                <select value={topUpBankCode} onChange={(event) => setTopUpBankCode(event.target.value as SingaPayVaBankCode)}>
                  {vaBanks.map((bank) => <option key={bank.code} value={bank.code}>{bank.label}</option>)}
                </select>
                <small>Bank yang bisa digunakan mengikuti aktivasi akun SingaPay.</small>
              </label>}
              {modalNeedsAmount && !topUpPayment && !existingTopUpLoading && <label>Jumlah top-up
                <div className="rupiah-input"><span>Rp</span><input autoFocus={modal.mode === 'top-up' || modal.mode === 'manual-top-up'} inputMode="numeric" type="number" min={modal.mode === 'top-up' ? topUpMinimum : 1} max="1000000000" step="1" required value={topUpAmount} onChange={(event) => setTopUpAmount(event.target.value)} placeholder="50000" /><small>{modal.mode === 'top-up' && topUpMethod === 'va' ? 'Minimum Rp10.000 · saldo khusus key ini' : 'Saldo khusus key ini'}</small></div>
              </label>}
              {modal.mode === 'manual-top-up' && <label>Alasan penyesuaian<input autoFocus maxLength={160} required value={manualTopUpReason} onChange={(event) => setManualTopUpReason(event.target.value)} placeholder="Contoh: koreksi pembayaran transfer" /></label>}
              {modalNeedsKey && <div className="key-handling-note"><Icon name="warning" size={15} /><span>Key dipakai untuk mencocokkan request lalu diteruskan ke DeepSeek. Sistem hanya menyimpan fingerprint, bukan nilai key.</span></div>}
              {modal.mode === 'revoke-key' && <div className="key-handling-note revoke-note"><Icon name="warning" size={15} /><span>Key akan langsung ditolak oleh gateway setelah dicabut.</span></div>}
              {modal.mode === 'top-up' && !topUpPayment && <div className="key-handling-note"><Icon name="wallet" size={15} /><span>{topUpMethod === 'va' ? 'Nomor VA berlaku sekitar satu jam dan hanya menerima satu pembayaran dengan nominal tepat.' : 'QRIS aktif selama sekitar satu jam.'} Saldo minimal Rp10 untuk memulai request; biaya aktual tetap dapat membuat saldo minus.</span></div>}
              {modal.mode === 'manual-top-up' && <div className="key-handling-note"><Icon name="warning" size={15} /><span>Penyesuaian langsung masuk ke saldo key dan tercatat bersama alasannya.</span></div>}
              <div className="modal-actions">
                {topUpPayment || existingTopUpLoading ? <button className="button button-quiet" type="button" onClick={closeModal}>Tutup</button> : <button className="button button-quiet" type="button" onClick={closeModal}>Batal</button>}
                {!topUpPayment && !existingTopUpLoading && <button className="button button-primary" type="submit" disabled={loading || (modal.mode === 'new-client' && (!clientName.trim() || !apiKey.trim())) || (modal.mode === 'add-key' && !apiKey.trim()) || (modal.mode === 'rename-client' && !clientName.trim()) || ((modal.mode === 'top-up' || modal.mode === 'manual-top-up') && (!Number.isSafeInteger(Number(topUpAmount)) || Number(topUpAmount) < topUpMinimum || Number(topUpAmount) > 1_000_000_000)) || (modal.mode === 'manual-top-up' && !manualTopUpReason.trim())}>{loading ? modal.mode === 'top-up' ? topUpMethod === 'va' ? 'Membuat VA…' : 'Membuat QRIS…' : 'Menyimpan…' : modal.mode === 'new-client' ? 'Simpan client' : modal.mode === 'add-key' ? 'Tambahkan key' : modal.mode === 'rename-client' ? 'Simpan nama' : modal.mode === 'revoke-key' ? 'Cabut key' : modal.mode === 'manual-top-up' ? 'Catat penyesuaian' : topUpMethod === 'va' ? 'Buat Virtual Account' : 'Buat QRIS'}</button>}
              </div>
            </form>
          </section>
        </div>
      )}
    </div>
  );
}

function LoginScreen({
  health,
  value,
  error,
  loading,
  onChange,
  onSubmit,
}: {
  health: Health | null;
  value: string;
  error: string;
  loading: boolean;
  onChange: (value: string) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}) {
  return (
    <main className="login-screen">
      <section className="login-card">
        <div className="brand-lockup login-brand"><div className="brand-glyph" aria-hidden="true"><span /><span /><span /></div><div><strong>DeepSeek</strong><span>Monitor</span></div></div>
        <h1>Ruang kendali pemakaian API</h1>
        <p className="login-copy">Pantau token, biaya rupiah, dan request dari tiap client yang melewati gateway.</p>
        <div className={`login-health ${health?.mongodb === 'connected' ? 'health-ok' : 'health-waiting'}`}>
          <Icon name={health?.mongodb === 'connected' ? 'database' : 'warning'} size={17} />
          <span>{health?.mongodb === 'connected' ? 'MongoDB lokal siap' : health ? 'MongoDB belum terhubung' : 'Memeriksa backend dan MongoDB'}</span>
          <i />
        </div>
        <form className="login-form" onSubmit={onSubmit}>
          <label htmlFor="admin-token">Token dashboard</label>
          <input id="admin-token" type="password" autoComplete="current-password" value={value} onChange={(event) => onChange(event.target.value)} required />
          {error && <p className="form-error" role="alert">{error}</p>}
          <button className="button button-primary login-submit" type="submit" disabled={loading}>{loading ? 'Menghubungkan…' : 'Buka dashboard'}</button>
        </form>
        <p className="login-footnote">Token lokal awal: <code>local-dev-token</code>. Dapat diganti melalui variabel <code>ADMIN_TOKEN</code>.</p>
      </section>
      <div className="login-art" aria-hidden="true"><div className="ledger-line line-one" /><div className="ledger-line line-two" /><div className="ledger-line line-three" /><div className="ledger-stamp"><span>INPUT</span><i /><span>OUTPUT</span><i /><span>RP</span></div></div>
    </main>
  );
}

function PageHeading({ title, description, action }: { title: string; description: string; action?: ReactNode }) {
  return <div className="page-heading"><div><h1>{title}</h1><p>{description}</p></div>{action}</div>;
}

function OverviewPage({
  overview,
  clients,
  pricing,
  days,
  setDays,
  onAdd,
  onNavigate,
}: {
  overview: Overview;
  clients: Client[];
  pricing: Pricing | null;
  days: number;
  setDays: (days: number) => void;
  onAdd: () => void;
  onNavigate: (view: View) => void;
}) {
  const activeClients = clients.filter((client) => client.status === 'active').length;
  return (
    <>
      <PageHeading
        title="Pemakaian"
        description="Biaya dan token yang tercatat lewat gateway DeepSeek."
        action={<div className="heading-actions"><label className="select-wrap"><span className="visually-hidden">Rentang waktu</span><select value={days} onChange={(event) => setDays(Number(event.target.value))}><option value={7}>7 hari</option><option value={30}>30 hari</option><option value={90}>90 hari</option></select><Icon name="chevron" size={15} /></label><button className="button button-primary" type="button" onClick={onAdd}><Icon name="add" size={17} />Tambah client</button></div>}
      />

      {clients.length === 0 ? (
        <section className="onboarding-panel">
          <div className="onboarding-copy"><span className="onboarding-mark"><Icon name="key" size={20} /></span><div><h2>Daftarkan key DeepSeek pertama</h2><p>Tambahkan nama client dan key yang sekarang mereka pakai. Setelah itu ubah base URL client agar request melewati gateway ini.</p></div></div>
          <button className="button button-primary" type="button" onClick={onAdd}><Icon name="add" size={17} />Daftarkan client</button>
        </section>
      ) : (
        <>
          <section className="overview-ledger">
            <div className="ledger-primary">
              <div className="ledger-caption"><span>Total biaya tercatat</span><span className="period-caption">{days} hari terakhir</span></div>
              <strong className="ledger-total">{formatRupiah(overview.totals.costIdr)}</strong>
              <div className="ledger-facts">
                <span><b>{formatNumber(overview.totals.tokens)}</b> token ditarif</span>
                <i />
                <span><b>{formatNumber(overview.totals.requests)}</b> request</span>
                <i />
                <span><b>{formatNumber(activeClients)}</b> client aktif</span>
              </div>
              <CostChart data={overview.series} />
            </div>
            <aside className="client-ranking">
              <div className="section-heading"><div><h2>Biaya per client</h2><p>Kontributor biaya periode ini</p></div><button className="text-button" type="button" onClick={() => onNavigate('clients')}>Lihat client</button></div>
              {overview.topClients.length === 0 ? <div className="ranking-empty">Belum ada request dengan usage token.</div> : <ol>{overview.topClients.map((client, index) => {
                const maxCost = Math.max(...overview.topClients.map((item) => item.costIdr), 1);
                return <li key={client.id}><div className="ranking-row"><span className="ranking-number">{String(index + 1).padStart(2, '0')}</span><div className="ranking-content"><strong>{client.name}</strong><span>{formatNumber(client.tokens)} token · {formatNumber(client.requests)} request</span><div className="rank-track"><i style={{ width: `${Math.max(3, (client.costIdr / maxCost) * 100)}%` }} /></div></div><b>{formatRupiah(client.costIdr)}</b></div></li>;
              })}</ol>}
              <div className="pricing-note"><span>Tarif aktif</span><strong>{formatRupiah(pricing?.pricePerMillionIdr ?? 50_000)} <small>/ 1 juta token</small></strong></div>
            </aside>
          </section>

          {overview.totals.errors > 0 && <div className="inline-alert"><Icon name="warning" size={16} /><span>{formatNumber(overview.totals.errors)} request mendapat respons error. Lihat detailnya di riwayat request.</span><button className="text-button" type="button" onClick={() => onNavigate('usage')}>Buka riwayat</button></div>}

          <section className="content-section latest-section">
            <div className="section-heading"><div><h2>Request terbaru</h2><p>Aktivitas terakhir yang melewati gateway.</p></div><button className="text-button" type="button" onClick={() => onNavigate('usage')}>Semua request</button></div>
            <UsageTable rows={overview.latest} compact />
          </section>
        </>
      )}
    </>
  );
}

function ClientsPage({
  clients,
  onAdd,
  onAddKey,
  onTopUp,
  onManualTopUp,
  onRename,
  onToggle,
  onRevoke,
  expanded,
  onExpand,
}: {
  clients: Client[];
  onAdd: () => void;
  onAddKey: (client: Client) => void;
  onTopUp: (client: Client, key: Client['keys'][number]) => void;
  onManualTopUp: (client: Client, key: Client['keys'][number]) => void;
  onRename: (client: Client) => void;
  onToggle: (client: Client) => void;
  onRevoke: (client: Client, keyId: string) => void;
  expanded: string | null;
  onExpand: (id: string) => void;
}) {
  return (
    <>
      <PageHeading title="Client & key" description="Setiap key memiliki saldo prabayar sendiri." action={<button className="button button-primary" type="button" onClick={onAdd}><Icon name="add" size={17} />Tambah client</button>} />
      {clients.length === 0 ? <section className="empty-page"><span className="empty-page-mark"><Icon name="key" size={22} /></span><h2>Belum ada client terdaftar</h2><p>Pasangkan key DeepSeek yang sudah digunakan client agar request dapat dikenali.</p><button className="button button-primary" type="button" onClick={onAdd}><Icon name="add" size={17} />Daftarkan client pertama</button></section> : (
        <section className="client-list-panel">
          <div className="client-list-heading"><span>Daftar client</span><span>{clients.length} terdaftar</span></div>
          {clients.map((client) => <article className="client-entry" key={client.id}>
            <div className="client-entry-main">
              <button className="client-expander" type="button" aria-expanded={expanded === client.id} onClick={() => onExpand(client.id)}><span className="client-avatar">{client.name.slice(0, 1).toLocaleUpperCase('id-ID')}</span><span className="client-identity"><strong>{client.name}</strong><small>{client.keys.length} key · dibuat {formatDate(client.createdAt, false)}</small></span><span className={`state ${client.status === 'active' ? 'state-success' : 'state-neutral'}`}><i />{client.status === 'active' ? 'Aktif' : 'Dijeda'}</span></button>
              <div className="client-stat"><strong>{formatNumber(client.requests)}</strong><span>request</span></div>
              <div className="client-stat"><strong>{formatNumber(client.billableTokens)}</strong><span>token</span></div>
              <div className="client-stat client-stat-cost"><strong>{formatRupiah(client.costIdr)}</strong><span>biaya tercatat</span></div>
              <button className="client-more" type="button" aria-label={`Tampilkan key milik ${client.name}`} aria-expanded={expanded === client.id} onClick={() => onExpand(client.id)}><Icon name="chevron" size={18} /></button>
            </div>
            {expanded === client.id && <div className="client-key-details">
              <div className="key-list-head"><div><strong>API key</strong><span>Nilai key disembunyikan setelah didaftarkan.</span></div><button className="button button-quiet button-small" type="button" onClick={() => onAddKey(client)}><Icon name="add" size={15} />Tambah key</button></div>
              {client.keys.length === 0 ? <p className="no-keys">Belum ada key terdaftar.</p> : client.keys.map((key) => {
                const hasBalance = key.balanceIdr >= 10;
                const keyLabel = key.status === 'revoked'
                  ? 'Dicabut'
                  : key.balanceIdr < 0
                    ? 'Saldo minus'
                    : key.balanceIdr === 0
                      ? 'Saldo habis'
                      : hasBalance
                        ? 'Siap dipakai'
                        : 'Di bawah Rp10';
                return (
                  <div className="key-row" key={key.id}>
                    <span className="key-row-icon"><Icon name="key" size={16} /></span>
                    <div className="key-row-identity"><code>{key.keyHint}</code><small>Terakhir dipakai {formatDate(key.lastUsedAt)}</small></div>
                    <div className="key-balance"><span>Saldo key</span><strong>{formatRupiahBalance(key.balanceIdr)}</strong>{key.lastTopUp && <small>{key.lastTopUp.source === 'singapay' && key.lastTopUp.status === 'pending' ? `${key.lastTopUp.method === 'va' ? 'VA' : 'QRIS'} menunggu` : key.lastTopUp.source === 'singapay' && key.lastTopUp.status === 'needs_review' ? `${key.lastTopUp.method === 'va' ? 'VA' : 'QRIS'} perlu ditinjau` : 'Top-up'} {formatRupiah(key.lastTopUp.amountIdr)} · {formatDate(key.lastTopUp.createdAt, false)}</small>}</div>
                    <span className={`state ${key.status === 'revoked' ? 'state-neutral' : hasBalance ? 'state-success' : 'state-warning'}`}><i />{keyLabel}</span>
                    {key.status === 'active' && <div className="key-actions">
                      <button className="button button-quiet button-small key-topup" type="button" onClick={() => onTopUp(client, key)}><Icon name="wallet" size={14} />{key.lastTopUp?.source === 'singapay' && activeTopUpStatuses.includes(key.lastTopUp.status ?? 'failed') ? `Lihat ${key.lastTopUp.method === 'va' ? 'VA' : 'QRIS'}` : 'Isi saldo'}</button>
                      <button className="text-button key-manual" type="button" onClick={() => onManualTopUp(client, key)}>Penyesuaian manual</button>
                      <button className="text-button danger-text key-revoke" type="button" onClick={() => onRevoke(client, key.id)}>Cabut key</button>
                    </div>}
                  </div>
                );
              })}
              <div className="client-tools"><button className="text-button" type="button" onClick={() => onRename(client)}>Ubah nama</button><button className="text-button" type="button" onClick={() => onToggle(client)}>{client.status === 'active' ? 'Jeda client' : 'Aktifkan client'}</button></div>
            </div>}
          </article>)}
        </section>
      )}
      <p className="page-footnote"><Icon name="warning" size={14} />Saldo dicatat per key. Request ditolak sebelum diteruskan jika saldo di bawah Rp10.</p>
    </>
  );
}

function TopUpPaymentPanel({ topUp, loading, onReconcile, onRetry }: {
  topUp: TopUp;
  loading: boolean;
  onReconcile: () => void;
  onRetry: () => void;
}) {
  const isVa = topUp.method === 'va';
  const paymentLabel = isVa ? 'Virtual Account' : 'QRIS';
  const [qrImage, setQrImage] = useState('');
  const [qrError, setQrError] = useState('');
  const [copyState, setCopyState] = useState('');

  useEffect(() => {
    if (isVa || !topUp.qrData) {
      setQrImage('');
      return;
    }
    let cancelled = false;
    setQrError('');
    QRCode.toDataURL(topUp.qrData, {
      errorCorrectionLevel: 'M',
      margin: 2,
      width: 240,
      color: { dark: '#24352f', light: '#ffffff' },
    })
      .then((url) => { if (!cancelled) setQrImage(url); })
      .catch(() => { if (!cancelled) setQrError('Kode QR tidak dapat ditampilkan. Salin kode QRIS di bawah untuk membukanya di aplikasi pembayaran.'); });
    return () => { cancelled = true; };
  }, [isVa, topUp.qrData]);

  const statusLabels: Record<TopUpStatus, string> = {
    creating: `Membuat ${paymentLabel}`,
    pending: 'Menunggu pembayaran',
    paid: 'Pembayaran diterima',
    expired: `${isVa ? 'VA' : 'QRIS'} kedaluwarsa`,
    failed: `${isVa ? 'VA' : 'QRIS'} gagal dibuat`,
    needs_review: 'Perlu ditinjau',
  };
  const statusMessage: Record<TopUpStatus, string> = {
    creating: `SingaPay sedang menyiapkan ${isVa ? 'nomor VA' : 'kode QR'}. Status akan diperbarui otomatis.`,
    pending: isVa
      ? 'Transfer dengan nominal tepat ke nomor VA ini. Saldo masuk setelah pembayaran dikonfirmasi.'
      : 'Pindai kode ini dengan aplikasi mobile banking atau e-wallet. Saldo masuk setelah pembayaran dikonfirmasi.',
    paid: 'Pembayaran telah dikonfirmasi dan saldo key sudah diperbarui.',
    expired: `Pembayaran ini sudah kedaluwarsa. Periksa status SingaPay sebelum membuat ${isVa ? 'VA' : 'QR'} pengganti.`,
    failed: `SingaPay menolak pembuatan ${isVa ? 'VA' : 'QR'}. Saldo belum berubah; periksa referensi sebelum mencoba lagi.`,
    needs_review: topUp.reviewReason ?? 'Status pembayaran belum dapat dipastikan. Jangan bayar ulang dulu; periksa referensi ini.',
  };
  const retryAvailable = Boolean(topUp.merchantRef) && (
    topUp.status === 'expired'
    || (topUp.status === 'failed' && !topUp.qrData && !topUp.vaNumber)
    || (topUp.status === 'needs_review' && !topUp.qrData && !topUp.vaNumber)
  );

  async function copyPaymentDetail() {
    const value = isVa ? topUp.vaNumber : topUp.qrData;
    if (!value) return;
    try {
      await navigator.clipboard.writeText(value);
      setCopyState(isVa ? 'Nomor VA disalin.' : 'Kode QRIS disalin.');
    } catch {
      setCopyState('Tidak dapat menyalin kode dari browser ini.');
    }
    window.setTimeout(() => setCopyState(''), 2500);
  }

  return (
    <section className={`topup-payment topup-payment-${topUp.status}`} aria-live="polite">
      <div className="topup-payment-heading">
        <div><span>Pembayaran {paymentLabel}</span><strong>{formatRupiah(topUp.amountIdr)}</strong></div>
        <span className={`payment-status payment-status-${topUp.status}`}><i aria-hidden="true" />{statusLabels[topUp.status]}</span>
      </div>
      {isVa && topUp.status === 'pending' && (
        <div className="va-payment-details">
          <span>{topUp.bankName ?? topUp.bankCode ?? 'Bank tujuan'}</span>
          <strong>{topUp.vaNumber ?? 'Nomor VA belum tersedia'}</strong>
          {topUp.vaNumber && <button className="button button-quiet button-small" type="button" onClick={() => void copyPaymentDetail()}><Icon name="copy" size={14} /> Salin nomor VA</button>}
          <p>{statusMessage[topUp.status]}</p>
          {copyState && <span className="copy-status" role="status">{copyState}</span>}
        </div>
      )}
      {!isVa && topUp.status === 'pending' && topUp.qrData && (
        <div className="qris-code-wrap">
          {qrImage ? <img className="qris-code-image" src={qrImage} alt={`QRIS ${formatRupiah(topUp.amountIdr)} untuk top-up saldo`} /> : <div className="qris-code-placeholder" role="status">{qrError || 'Menyiapkan kode QR…'}</div>}
          <p>{statusMessage[topUp.status]}</p>
        </div>
      )}
      {(!isVa && (topUp.status !== 'pending' || !topUp.qrData)) || (isVa && topUp.status !== 'pending') ? <p className="topup-status-message">{statusMessage[topUp.status]}</p> : null}
      <dl className="topup-payment-meta">
        <div><dt>Referensi</dt><dd>{topUp.merchantRef ?? 'Belum tersedia'}</dd></div>
        {isVa && topUp.bankName && <div><dt>Bank</dt><dd>{topUp.bankName}</dd></div>}
        {topUp.status === 'pending' && topUp.expiresAt && <div><dt>Berlaku sampai</dt><dd>{formatDate(topUp.expiresAt)}</dd></div>}
        {topUp.paidAt && <div><dt>Dibayar</dt><dd>{formatDate(topUp.paidAt)}</dd></div>}
      </dl>
      {!isVa && topUp.status === 'pending' && topUp.qrData && (
        <details className="topup-raw-data">
          <summary>Lihat kode QRIS</summary>
          <code>{topUp.qrData}</code>
          <button className="text-button" type="button" onClick={() => void copyPaymentDetail()}><Icon name="copy" size={14} /> Salin kode</button>
          {copyState && <span role="status">{copyState}</span>}
        </details>
      )}
      {retryAvailable && <p className="topup-retry-note">SingaPay diperiksa lagi sebelum {isVa ? 'VA' : 'QR'} pengganti dibuat. Pembayaran lama yang masuk belakangan tetap bisa menambah saldo.</p>}
      {(retryAvailable || reconcilableTopUpStatuses.includes(topUp.status)) && topUp.merchantRef && (
        <div className="topup-actions">
          {retryAvailable && <button
            className="button button-primary button-small topup-retry"
            type="button"
            disabled={loading}
            onClick={onRetry}
          >
            {loading ? 'Memeriksa SingaPay…' : topUp.status === 'expired' ? `Periksa & buat ${isVa ? 'VA' : 'QR'} baru` : topUp.status === 'failed' ? `Coba buat ${isVa ? 'VA' : 'QR'} lagi` : `Cari atau buat ${isVa ? 'VA' : 'QR'}`}
          </button>}
          {reconcilableTopUpStatuses.includes(topUp.status) && <button
            className="button button-quiet button-small topup-reconcile"
            type="button"
            disabled={loading}
            onClick={onReconcile}
          >
            {loading ? 'Memeriksa status…' : topUp.status === 'needs_review' || topUp.status === 'failed' ? 'Periksa ke SingaPay' : topUp.status === 'expired' ? 'Periksa pembayaran' : 'Perbarui status'}
          </button>}
        </div>
      )}
      {qrError && <p className="qris-inline-error" role="alert">{qrError}</p>}
    </section>
  );
}

function UsagePage({
  clients,
  rows,
  clientId,
  search,
  onClientChange,
  onSearchChange,
}: {
  clients: Client[];
  rows: UsageRow[];
  clientId: string;
  search: string;
  onClientChange: (id: string) => void;
  onSearchChange: (value: string) => void;
}) {
  return (
    <>
      <PageHeading title="Riwayat request" description="Satu baris untuk setiap pemanggilan yang diterima gateway." />
      <section className="content-section usage-history-section">
        <div className="usage-toolbar">
          <label className="search-field"><Icon name="search" size={16} /><span className="visually-hidden">Cari request</span><input value={search} onChange={(event) => onSearchChange(event.target.value)} placeholder="Cari client, model, atau endpoint" /></label>
          <label className="select-wrap"><span className="visually-hidden">Filter client</span><select value={clientId} onChange={(event) => onClientChange(event.target.value)}><option value="all">Semua client</option>{clients.map((client) => <option key={client.id} value={client.id}>{client.name}</option>)}</select><Icon name="chevron" size={15} /></label>
          <span className="usage-count">{formatNumber(rows.length)} request ditampilkan</span>
        </div>
        <UsageTable rows={rows} />
      </section>
      <p className="page-footnote"><Icon name="warning" size={14} />Jika usage token tidak disertakan DeepSeek, biaya ditampilkan sebagai tanda strip dan tidak diasumsikan nol.</p>
    </>
  );
}

function PricingPage({
  pricing,
  value,
  loading,
  onChange,
  onSubmit,
}: {
  pricing: Pricing | null;
  value: string;
  loading: boolean;
  onChange: (value: string) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}) {
  const amount = Number(value);
  const previewTokens = 100_000;
  const previewCost = Number.isFinite(amount) ? (previewTokens / 1_000_000) * amount : 0;
  return (
    <>
      <PageHeading title="Tarif token" description="Satu tarif rata untuk token input dan output. Cache hit/miss tetap terlihat sebagai rincian input." />
      <div className="pricing-layout">
        <section className="pricing-form-panel">
          <div className="pricing-panel-heading"><span className="pricing-mark"><Icon name="pricing" size={18} /></span><div><h2>Tarif aktif</h2><p>Tarif yang dipakai menghitung request baru.</p></div></div>
          <form onSubmit={onSubmit}>
            <label htmlFor="price-per-million">Harga per 1 juta token</label>
            <div className="rupiah-input"><span>Rp</span><input id="price-per-million" inputMode="numeric" type="number" min="0" step="1" value={value} onChange={(event) => onChange(event.target.value)} required /><small>/ 1 juta token</small></div>
            <p className="field-help">Nilai historis request memakai tarif yang tersimpan ketika request terjadi. Perubahan tarif hanya berlaku untuk request berikutnya.</p>
            <button className="button button-primary" type="submit" disabled={loading}>{loading ? 'Menyimpan…' : 'Simpan tarif'}</button>
          </form>
          <div className="pricing-divider" />
          <div className="pricing-current"><span>Tarif tersimpan</span><strong>{formatRupiah(pricing?.pricePerMillionIdr ?? 50_000)} <small>/ 1 juta token</small></strong><span>{pricing?.updatedAt ? `Diubah ${formatDate(pricing.updatedAt)}` : 'Tarif awal'}</span></div>
        </section>
        <aside className="calculation-panel">
          <span className="calculation-label">Contoh kalkulasi</span>
          <h2>{formatNumber(previewTokens)} token</h2>
          <div className="calculation-breakdown"><span>Token terpakai</span><strong>{formatNumber(previewTokens)}</strong><span>Tarif per 1 juta</span><strong>{formatRupiah(amount)}</strong></div>
          <div className="calculation-result"><span>Biaya</span><strong>{formatRupiah(previewCost)}</strong></div>
          <p>Cache hit + cache miss adalah rincian token input. Keduanya tidak ditambahkan lagi di luar total input.</p>
        </aside>
      </div>
      <section className="pricing-rule"><div className="rule-mark"><Icon name="check" size={17} /></div><div><strong>Input dihitung sekali</strong><p>Total yang ditarif = input + output. Input mencakup cache hit dan cache miss; angka cache disimpan agar pemakaian DeepSeek tetap bisa dibandingkan.</p></div></section>
    </>
  );
}
