import { LitElement, html, nothing } from 'lit';
import type { CSSResultGroup, PropertyDeclarations, PropertyValues, TemplateResult } from 'lit';
import { MINUTE } from '../const';
import type { HomeAssistant, LovelaceGridOptions } from '../types/ha';
import { MetronCardEditor } from '../ui/editor';
import { createForm } from '../ui/form';
import type { ConfigForm } from '../ui/form';
import { metronStyles } from '../ui/styles';
import { openMoreInfo } from './actions';
import { toFormatLocale } from './format';
import type { FormatLocale } from './format';
import { createLocalize, resolveLanguage } from './i18n';
import type { Localize, TranslationKey } from './i18n';

export type RawConfig = Readonly<Record<string, unknown>>;

export interface BaseConfig {
  readonly type: string;
  readonly title?: string | false;
  readonly language?: string;
  readonly colors?: Readonly<Record<string, string>>;
  readonly labels?: Readonly<Record<string, string>>;
}

export interface CardContext<C extends BaseConfig, D> {
  readonly config: C;
  readonly hass: HomeAssistant;
  readonly data: D | undefined;
  readonly t: Localize;
  readonly locale: FormatLocale;
  readonly now: number;
  readonly moreInfo: (entityId: string | undefined) => void;
  readonly update: () => void;
}

const unitDictionary = (t: Localize): Readonly<Record<string, string>> => ({
  W: t('unit.w'),
  kW: t('unit.kw'),
  kWh: t('unit.kwh'),
  MWh: t('unit.mwh'),
  'm³': t('unit.m3'),
  Hz: t('unit.hz'),
  V: t('unit.v'),
  A: t('unit.a'),
  h: t('unit.h'),
  min: t('unit.min'),
  d: t('unit.d'),
});

const COLOR_KEYS = new Set(['solar', 'home', 'battery', 'grid', 'gas', 'warning', 'cold', 'ok']);

const colorStyle = (colors: Readonly<Record<string, string>> | undefined): string =>
  Object.entries(colors ?? {})
    .filter(([key, value]) => COLOR_KEYS.has(key) && typeof value === 'string')
    .map(([key, value]) => `--metron-${key}-color:${value}`)
    .join(';');

const hassChanged = (
  previous: HomeAssistant | undefined,
  current: HomeAssistant | undefined,
  entityIds: readonly (string | undefined)[],
): boolean => {
  if (!previous || !current) return true;
  if (previous.locale !== current.locale) return true;
  if (previous.themes?.darkMode !== current.themes?.darkMode) return true;

  return entityIds.some(
    (entityId) => entityId !== undefined && previous.states[entityId] !== current.states[entityId],
  );
};

export abstract class MetronCard<C extends BaseConfig, D = never> extends LitElement {
  static override properties: PropertyDeclarations = {
    hass: { attribute: false },
    _config: { state: true },
    _data: { state: true },
    _tick: { state: true },
  };

  static override styles: CSSResultGroup = metronStyles;

  declare hass: HomeAssistant | undefined;
  declare _config: C | undefined;
  declare _data: D | undefined;
  declare _tick: number;

  static configForm(): ConfigForm {
    return createForm([]);
  }

  static getConfigElement(): MetronCardEditor {
    const editor = new MetronCardEditor();

    editor.form = this.configForm();

    return editor;
  }

  private _dataKey: string | undefined;

  private _requested = false;

  private _refreshTimer: number | undefined;

  private _tickTimer: number | undefined;

  protected abstract parseConfig(raw: RawConfig): C;

  protected abstract renderBody(context: CardContext<C, D>): TemplateResult;

  protected trackedEntities(_config: C): readonly (string | undefined)[] {
    return [];
  }

  protected fetchData(_config: C, _hass: HomeAssistant): Promise<D> | undefined {
    return undefined;
  }

  protected refreshInterval(_config: C): number {
    return 5 * MINUTE;
  }

  protected tickInterval(_config: C): number {
    return MINUTE;
  }

  protected cardSize(_config: C): number {
    return 4;
  }

  protected missingOption(_config: C): string | undefined {
    return undefined;
  }

  setConfig(raw: RawConfig): void {
    if (!raw || typeof raw !== 'object') throw new Error('Invalid configuration');

    const config = this.parseConfig(raw);
    const key = JSON.stringify(config);

    if (key !== this._dataKey) {
      this._dataKey = key;
      this._data = undefined;
      this._requested = false;
    }

    this._config = config;
    this._restartTimers();
  }

  getCardSize(): number {
    return this._config ? this.cardSize(this._config) : 4;
  }

  getGridOptions(): LovelaceGridOptions {
    return { columns: 12, rows: 'auto', min_columns: 6 };
  }

  override connectedCallback(): void {
    super.connectedCallback();
    this._restartTimers();
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    this._stopTimers();
    this._requested = false;
  }

  protected override shouldUpdate(changed: PropertyValues<this>): boolean {
    if (!this._config) return false;
    if (changed.size !== 1 || !changed.has('hass')) return true;

    return hassChanged(changed.get('hass'), this.hass, this.trackedEntities(this._config));
  }

  protected override willUpdate(): void {
    if (this._requested || !this.hass || !this._config) return;

    this._requested = true;
    void this._load();
  }

  protected override render(): TemplateResult | typeof nothing {
    const config = this._config;
    const hass = this.hass;

    if (!config || !hass) return nothing;

    const language = resolveLanguage(config.language ?? hass.locale.language);
    const t = createLocalize(language, config.labels);
    const missing = this.missingOption(config);

    if (missing) {
      const key = `editor.${missing}` as TranslationKey;
      const label = t(key);

      return html`<ha-card class="metron" style="padding:16px">
        <div class="empty">
          ${t('common.configure', { option: label === key ? missing : label })}
        </div>
      </ha-card>`;
    }

    return html`<ha-card class="metron" style=${colorStyle(config.colors)}>
      ${this.renderBody({
        config,
        hass,
        data: this._data,
        t,
        locale: toFormatLocale(hass.locale, language, unitDictionary(t)),
        now: Date.now(),
        moreInfo: (entityId) => {
          openMoreInfo(this, entityId);
        },
        update: () => {
          this.requestUpdate();
        },
      })}
    </ha-card>`;
  }

  protected reload(): void {
    void this._load();
  }

  private async _load(): Promise<void> {
    const config = this._config;
    const hass = this.hass;

    if (!config || !hass || this.missingOption(config)) return;

    const key = this._dataKey;
    const request = this.fetchData(config, hass);

    if (!request) return;

    try {
      const data = await request;

      if (key !== this._dataKey) return;

      this._data = data;
    } catch (error) {
      console.warn(`${this.localName}: unable to load data`, error);
    }
  }

  private _restartTimers(): void {
    this._stopTimers();

    const config = this._config;

    if (!config || !this.isConnected) return;

    this._refreshTimer = window.setInterval(() => {
      void this._load();
    }, this.refreshInterval(config));
    this._tickTimer = window.setInterval(() => {
      this._tick = Date.now();
    }, this.tickInterval(config));
  }

  private _stopTimers(): void {
    window.clearInterval(this._refreshTimer);
    window.clearInterval(this._tickTimer);
    this._refreshTimer = undefined;
    this._tickTimer = undefined;
  }
}
