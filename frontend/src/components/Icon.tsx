import { ReactNode, SVGProps } from 'react';

export type IconName = 'overview' | 'clients' | 'usage' | 'pricing' | 'add' | 'refresh' | 'search' | 'copy' | 'chevron' | 'close' | 'check' | 'key' | 'clock' | 'warning' | 'arrow-up' | 'database' | 'wallet';

const paths: Record<IconName, ReactNode> = {
  overview: <><rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" /><rect x="3" y="14" width="7" height="7" rx="1" /><path d="M14 14h7v7h-7z" /></>,
  clients: <><path d="M16 20v-1.5a3.5 3.5 0 0 0-3.5-3.5h-5A3.5 3.5 0 0 0 4 18.5V20" /><circle cx="10" cy="7.5" r="3.5" /><path d="M17 11a3.5 3.5 0 0 0 0-7M20 20v-1.5a3.5 3.5 0 0 0-2.5-3.36" /></>,
  usage: <><path d="M6 4h12a2 2 0 0 1 2 2v14l-3-2-3 2-3-2-3 2-3-2V6a2 2 0 0 1 2-2Z" /><path d="M8 9h8M8 13h5" /></>,
  pricing: <><path d="M12 3v18M17 7.5c0-1.38-1.8-2.5-4-2.5s-4 1.12-4 2.5 1.8 2.5 4 2.5 4 1.12 4 2.5-1.8 2.5-4 2.5-4-1.12-4-2.5" /><path d="M5 5h14v14H5z" /></>,
  add: <><path d="M12 5v14M5 12h14" /></>,
  refresh: <><path d="M20 7v5h-5" /><path d="M4.7 9a7.5 7.5 0 0 1 12.5-2L20 12M4 17v-5h5" /><path d="M19.3 15a7.5 7.5 0 0 1-12.5 2L4 12" /></>,
  search: <><circle cx="10.8" cy="10.8" r="6.8" /><path d="m16 16 4.5 4.5" /></>,
  copy: <><rect x="8" y="8" width="12" height="12" rx="2" /><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2" /></>,
  chevron: <path d="m8 10 4 4 4-4" />,
  close: <><path d="m6 6 12 12M18 6 6 18" /></>,
  check: <path d="m5 12 4 4L19 6" />,
  key: <><circle cx="8" cy="15" r="4" /><path d="m11 12 8-8 2 2-2 2 2 2-3 3-2-2-2 2" /></>,
  clock: <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>,
  warning: <><path d="M10.3 4.3 2.9 17.1A2 2 0 0 0 4.6 20h14.8a2 2 0 0 0 1.7-2.9L13.7 4.3a2 2 0 0 0-3.4 0Z" /><path d="M12 9v4m0 3h.01" /></>,
  'arrow-up': <><path d="M7 17 17 7M7 7h10v10" /></>,
  database: <><ellipse cx="12" cy="5" rx="8" ry="3" /><path d="M4 5v7c0 1.66 3.58 3 8 3s8-1.34 8-3V5M4 12v7c0 1.66 3.58 3 8 3s8-1.34 8-3v-7" /></>,
  wallet: <><path d="M4 7.5A2.5 2.5 0 0 1 6.5 5H19a2 2 0 0 1 2 2v12H6.5A2.5 2.5 0 0 1 4 16.5z" /><path d="M4 8h14a3 3 0 0 1 3 3v2h-6a2 2 0 0 1 0-4h6M16 11h.01" /></>,
};

interface IconProps extends SVGProps<SVGSVGElement> {
  name: IconName;
  size?: number;
}

export function Icon({ name, size = 18, ...props }: IconProps) {
  return (
    <svg
      aria-hidden="true"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      {...props}
    >
      {paths[name]}
    </svg>
  );
}
