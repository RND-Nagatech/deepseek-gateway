import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { AppSetting, AppSettingDocument } from '../common/schemas';

@Injectable()
export class PricingService {
  constructor(@InjectModel(AppSetting.name) private readonly settings: Model<AppSettingDocument>) {}

  async getCurrent() {
    const configured = Math.max(0, Math.floor(Number(process.env.PRICE_PER_MILLION_IDR ?? 50_000)));
    const setting = await this.settings.findOneAndUpdate(
      { name: 'pricing' },
      { $setOnInsert: { name: 'pricing', pricePerMillionIdr: configured } },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    ).lean().exec();

    return {
      currency: 'IDR',
      pricePerMillionIdr: setting.pricePerMillionIdr,
      updatedAt: setting.updatedAt,
    };
  }

  async update(pricePerMillionIdr: number) {
    const price = Math.max(0, Math.floor(pricePerMillionIdr));
    const setting = await this.settings.findOneAndUpdate(
      { name: 'pricing' },
      { $set: { pricePerMillionIdr: price } },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    ).lean().exec();

    return {
      currency: 'IDR',
      pricePerMillionIdr: setting.pricePerMillionIdr,
      updatedAt: setting.updatedAt,
    };
  }
}
