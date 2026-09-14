import { Notice, Plugin, TAbstractFile, TFile } from "obsidian";
import { patchAdapter, type PatchedAdapter } from "./adapter";
import {
  bytesToB64,
  isEnvelope,
  nextKeyId,
  parseEnvelope,
  randomKeyBytes,
  revealText,
  sealText,
  b64ToBytes,
} from "./codec";
import { ConfirmModal } from "./confirm-modal";
import { GuideModal } from "./guide";
import { isCloakPath } from "./scope";
import { EncryptSettingTab } from "./settings-tab";
import { DEFAULT_SETTINGS, LEGACY_PLUGIN_ID, type EncryptSettings } from "./types";

export default class VaultCloakPlugin extends Plugin {
  settings: EncryptSettings = { ...DEFAULT_SETTINGS };
  private patched: PatchedAdapter | null = null;
  private statusBar: HTMLElement | null = null;
  private busyPaths = new Set<string>();
  private rawTimers = new Map<string, number>();
  private skipAutoCloak = new Set<string>();
  private suspendWatcher = false;

  async onload(): Promise<void> {
    await this.loadSettings();
    this.patched = patchAdapter(this.app.vault.adapter, {
      isArmed: () => this.settings.armed,
      reveal: (path, data) => this.reveal(path, data),
      seal: (path, data) => {
        this.skipAutoCloak.delete(path);
        return this.seal(data);
      },
    });

    this.addSettingTab(new EncryptSettingTab(this.app, this));
    this.registerCommands();
    this.statusBar = this.addStatusBarItem();
    this.statusBar.addClass("mod-clickable");
    this.statusBar.setAttribute("aria-label", "Vault Cloak");
    this.statusBar.addEventListener("click", () => this.openPluginSettings());
    this.updateStatusBar();

    this.registerEvent(this.app.workspace.on("file-open", () => this.updateStatusBar()));
    this.registerEvent(this.app.vault.on("create", (file) => void this.onVaultCreate(file)));
    this.registerEvent(
      this.app.vault.on("modify", (file) => {
        if (file instanceof TFile) {
          this.onVaultModify(file.path);
        }
      }),
    );

    this.app.workspace.onLayoutReady(() => {
      void this.onLayoutReady();
    });
  }

  onunload(): void {
    for (const timer of this.rawTimers.values()) {
      window.clearTimeout(timer);
    }
    this.rawTimers.clear();
    this.patched?.unpatch();
    this.patched = null;
  }

  async onExternalSettingsChange(): Promise<void> {
    const data = await this.loadData();
    if (data) {
      this.settings = Object.assign({}, DEFAULT_SETTINGS, data) as EncryptSettings;
      this.updateStatusBar();
    }
  }

  isFileRecoveryEnabled(): boolean {
    try {
      const internal = this.app as unknown as {
        internalPlugins?: { plugins?: Record<string, { enabled?: boolean }> };
      };
      return internal.internalPlugins?.plugins?.["file-recovery"]?.enabled === true;
    } catch {
      return false;
    }
  }

  updateStatusBar(): void {
    if (!this.statusBar) {
      return;
    }
    const file = this.app.workspace.getActiveFile();
    if (!file || !isCloakPath(file.path)) {
      this.statusBar.setText("");
      return;
    }
    this.statusBar.setText(this.settings.armed ? "Cloaked" : "Encrypt: off");
  }

  async cloakRemaining(options?: { notify?: boolean }): Promise<number> {
    if (!this.settings.armed) {
      if (options?.notify) {
        new Notice("Vault Cloak is off. Turn cloaking on before encrypting notes.");
      }
      return 0;
    }
    this.suspendWatcher = true;
    let count = 0;
    try {
      for (const file of this.app.vault.getMarkdownFiles()) {
        if (await this.cloakIfPlaintext(file.path, true)) {
          count += 1;
        }
      }
    } finally {
      this.suspendWatcher = false;
    }
    if (options?.notify) {
      new Notice(
        count === 0
          ? "Vault Cloak: every Markdown note is already cloaked."
          : `Vault Cloak: cloaked ${count} note(s).`,
      );
    }
    return count;
  }

  async rotateKey(): Promise<void> {
    if (!this.settings.armed) {
      new Notice("Turn cloaking on before rotating the key.");
      return;
    }
    const newId = nextKeyId(this.settings.keys);
    this.settings.keys[newId] = bytesToB64(randomKeyBytes());
    this.settings.currentKeyId = newId;
    await this.saveSettings();

    this.suspendWatcher = true;
    let count = 0;
    let failed = 0;
    try {
      for (const file of this.app.vault.getMarkdownFiles()) {
        try {
          const raw = await this.readRaw(file.path);
          const revealed = await revealText(raw, this.settings.keys);
          const sealed = await this.seal(revealed.text);
          if (sealed !== raw) {
            await this.writeRaw(file.path, sealed);
            count += 1;
          }
        } catch (error) {
          failed += 1;
          console.error(`Vault Cloak: rotate failed for ${file.path}`, error);
        }
      }
    } finally {
      this.suspendWatcher = false;
    }
    this.reloadMarkdownViews();
    this.updateStatusBar();
    new Notice(
      failed === 0
        ? `Vault Cloak: now using ${newId}. Rewrote ${count} note(s).`
        : `Vault Cloak: now using ${newId}. Rewrote ${count} note(s), ${failed} failed.`,
    );
  }

  async retireUnusedKeys(): Promise<void> {
    const used = new Set<string>([this.settings.currentKeyId]);
    for (const file of this.app.vault.getMarkdownFiles()) {
      try {
        const envelope = parseEnvelope(await this.readRaw(file.path));
        if (envelope) {
          used.add(envelope.keyId);
        }
      } catch (error) {
        console.error(`Vault Cloak: could not inspect ${file.path}`, error);
      }
    }
    const before = Object.keys(this.settings.keys);
    for (const id of before) {
      if (!used.has(id)) {
        delete this.settings.keys[id];
      }
    }
    await this.saveSettings();
    const removed = before.length - Object.keys(this.settings.keys).length;
    new Notice(
      removed === 0
        ? "Vault Cloak: no unused keys to retire."
        : `Vault Cloak: retired ${removed} unused key(s).`,
    );
  }

  async decryptVault(): Promise<void> {
    this.settings.armed = false;
    await this.saveSettings();
    this.suspendWatcher = true;
    let count = 0;
    let failed = 0;
    try {
      for (const file of this.app.vault.getMarkdownFiles()) {
        try {
          const raw = await this.readRaw(file.path);
          const revealed = await revealText(raw, this.settings.keys);
          if (revealed.enveloped) {
            await this.writeRaw(file.path, revealed.text);
            count += 1;
          }
        } catch (error) {
          failed += 1;
          console.error(`Vault Cloak: decrypt failed for ${file.path}`, error);
        }
      }
    } finally {
      this.suspendWatcher = false;
    }
    this.reloadMarkdownViews();
    this.updateStatusBar();
    new Notice(
      failed === 0
        ? `Vault Cloak: wrote ${count} note(s) as plaintext and turned cloaking off.`
        : `Vault Cloak: decrypted ${count} note(s), ${failed} failed. Cloaking is off.`,
    );
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
  }

  openUserGuide(): void {
    new GuideModal(this.app, this).open();
  }

  private async onLayoutReady(): Promise<void> {
    if (this.isFileRecoveryEnabled() && !this.settings.fileRecoveryAcknowledged) {
      new Notice(
        "Vault Cloak: File Recovery is on and can leak plaintext snapshots. Turn it off.",
        8000,
      );
    }
    const cloaked = await this.cloakRemaining();
    this.reloadMarkdownViews();
    this.updateStatusBar();
    if (cloaked > 0) {
      new Notice(`Vault Cloak: cloaked ${cloaked} note(s) on disk.`);
    }
  }

  private registerCommands(): void {
    this.addCommand({
      id: "open-user-guide",
      name: "Open user guide",
      callback: () => this.openUserGuide(),
    });
    this.addCommand({
      id: "cloak-remaining",
      name: "Cloak remaining plaintext notes",
      callback: () => {
        void this.cloakRemaining({ notify: true });
      },
    });
    this.addCommand({
      id: "rotate-key",
      name: "Rotate encryption key",
      callback: () => {
        new ConfirmModal(
          this.app,
          "Create a new AES key and rewrite every Markdown note. Keep this vault closed on other computers until the rewrite finishes.",
          () => {
            void this.rotateKey();
          },
          "Rotate key",
        ).open();
      },
    });
    this.addCommand({
      id: "retire-unused-keys",
      name: "Retire unused encryption keys",
      callback: () => {
        void this.retireUnusedKeys();
      },
    });
    this.addCommand({
      id: "decrypt-vault",
      name: "Decrypt entire vault",
      callback: () => {
        new ConfirmModal(
          this.app,
          "This writes every note back to plaintext on disk. Cloud and antivirus scanners will be able to see the contents again.",
          () => {
            void this.decryptVault();
          },
          "Decrypt vault",
        ).open();
      },
    });
    this.addCommand({
      id: "cloak-current",
      name: "Cloak current note",
      checkCallback: (checking) => {
        const file = this.app.workspace.getActiveFile();
        if (!file || !isCloakPath(file.path)) {
          return false;
        }
        if (!checking) {
          void this.cloakIfPlaintext(file.path, true).then((changed) => {
            new Notice(
              changed
                ? "Vault Cloak: current note cloaked."
                : "Vault Cloak: current note was already cloaked.",
            );
            this.updateStatusBar();
          });
        }
        return true;
      },
    });
    this.addCommand({
      id: "decrypt-current",
      name: "Decrypt current note to disk",
      checkCallback: (checking) => {
        const file = this.app.workspace.getActiveFile();
        if (!file || !isCloakPath(file.path)) {
          return false;
        }
        if (!checking) {
          void this.decryptCurrent(file);
        }
        return true;
      },
    });
  }

  private async decryptCurrent(file: TFile): Promise<void> {
    try {
      const raw = await this.readRaw(file.path);
      const revealed = await revealText(raw, this.settings.keys);
      if (!revealed.enveloped) {
        new Notice("Vault Cloak: current note is already plaintext on disk.");
        return;
      }
      this.skipAutoCloak.add(file.path);
      await this.writeRaw(file.path, revealed.text);
      new Notice(
        this.settings.armed
          ? "Vault Cloak: current note is plaintext on disk. The next save will cloak it again."
          : "Vault Cloak: current note is plaintext on disk.",
      );
    } catch (error) {
      console.error(error);
      new Notice(`Vault Cloak: failed to decrypt ${file.path}`);
    }
  }

  private async onVaultCreate(file: TAbstractFile): Promise<void> {
    if (!(file instanceof TFile) || !isCloakPath(file.path)) {
      return;
    }
    window.setTimeout(() => {
      void this.cloakIfPlaintext(file.path);
    }, 400);
  }

  private onVaultModify(path: string): void {
    if (!isCloakPath(path)) {
      return;
    }
    const previous = this.rawTimers.get(path);
    if (previous !== undefined) {
      window.clearTimeout(previous);
    }
    const timer = window.setTimeout(() => {
      this.rawTimers.delete(path);
      void this.cloakIfPlaintext(path);
    }, 500);
    this.rawTimers.set(path, timer);
  }

  private async cloakIfPlaintext(path: string, force = false): Promise<boolean> {
    if (
      !force &&
      (this.suspendWatcher || this.skipAutoCloak.has(path) || this.busyPaths.has(path))
    ) {
      return false;
    }
    if (!this.settings.armed || !isCloakPath(path) || this.busyPaths.has(path)) {
      return false;
    }
    this.busyPaths.add(path);
    try {
      if (!(await this.app.vault.adapter.exists(path))) {
        return false;
      }
      const raw = await this.readRaw(path);
      if (isEnvelope(raw)) {
        return false;
      }
      await this.writeRaw(path, await this.seal(raw));
      return true;
    } catch (error) {
      console.error(`Vault Cloak: cloak failed for ${path}`, error);
      return false;
    } finally {
      this.busyPaths.delete(path);
    }
  }

  private async reveal(path: string, data: string): Promise<string> {
    try {
      const revealed = await revealText(data, this.settings.keys);
      return revealed.text;
    } catch (error) {
      console.error(`Vault Cloak: reveal failed for ${path}`, error);
      new Notice(`Vault Cloak: cannot decrypt ${path}`);
      return data;
    }
  }

  private async seal(plaintext: string): Promise<string> {
    const keyId = this.settings.currentKeyId;
    const keyB64 = this.settings.keys[keyId];
    if (!keyId || !keyB64) {
      throw new Error("No encryption key is configured");
    }
    return sealText(plaintext, keyId, b64ToBytes(keyB64));
  }

  private async readRaw(path: string): Promise<string> {
    if (!this.patched) {
      return this.app.vault.adapter.read(path);
    }
    return this.patched.readRaw(path);
  }

  private async writeRaw(path: string, data: string): Promise<void> {
    if (!this.patched) {
      await this.app.vault.adapter.write(path, data);
      return;
    }
    await this.patched.writeRaw(path, data);
  }

  private async loadSettings(): Promise<void> {
    let stored = (await this.loadData()) as EncryptSettings | null;
    let migrated = false;
    if (!this.hasKeyring(stored)) {
      const legacy = await this.readLegacySettings();
      if (legacy) {
        stored = legacy;
        migrated = true;
      }
    }
    this.settings = Object.assign({}, DEFAULT_SETTINGS, stored ?? {}) as EncryptSettings;
    if (!this.settings.keys) {
      this.settings.keys = {};
    }
    if (!this.settings.currentKeyId || !this.settings.keys[this.settings.currentKeyId]) {
      const id = nextKeyId(this.settings.keys);
      this.settings.currentKeyId = id;
      this.settings.keys[id] = bytesToB64(randomKeyBytes());
      migrated = true;
    }
    if (migrated) {
      await this.saveSettings();
    }
  }

  private hasKeyring(stored: EncryptSettings | null): stored is EncryptSettings {
    return !!stored?.currentKeyId && !!stored.keys?.[stored.currentKeyId];
  }

  private async readLegacySettings(): Promise<EncryptSettings | null> {
    const legacyPath = `.obsidian/plugins/${LEGACY_PLUGIN_ID}/data.json`;
    try {
      if (!(await this.app.vault.adapter.exists(legacyPath))) {
        return null;
      }
      const parsed = JSON.parse(await this.app.vault.adapter.read(legacyPath)) as EncryptSettings;
      if (!this.hasKeyring(parsed)) {
        return null;
      }
      new Notice("Vault Cloak: imported the secret from the older plugin folder.");
      return parsed;
    } catch (error) {
      console.error("Vault Cloak: could not import legacy settings", error);
      return null;
    }
  }

  private reloadMarkdownViews(): void {
    for (const leaf of this.app.workspace.getLeavesOfType("markdown")) {
      void leaf.setViewState(leaf.getViewState());
    }
  }

  private openPluginSettings(): void {
    const setting = (
      this.app as unknown as {
        setting?: { open: () => void; openTabById: (id: string) => void };
      }
    ).setting;
    setting?.open();
    setting?.openTabById(this.manifest.id);
  }
}
