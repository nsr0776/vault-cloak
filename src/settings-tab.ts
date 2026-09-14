import { App, PluginSettingTab, Setting } from "obsidian";
import { ConfirmModal } from "./confirm-modal";
import { GuideModal, renderUserGuide } from "./guide";
import type VaultCloakPlugin from "./main";

export class EncryptSettingTab extends PluginSettingTab {
  plugin: VaultCloakPlugin;

  constructor(app: App, plugin: VaultCloakPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    containerEl.createEl("h2", { text: "Vault Cloak" });
    containerEl.createEl("p", {
      text: "If you just turned this on and feel a bit lost, start with the guide. It is written for humans, not for a changelog.",
    });

    new Setting(containerEl)
      .setName("User guide")
      .setDesc("The same guide is printed below. Open it in a window if you would rather read it over a note.")
      .addButton((button) => {
        button.setButtonText("Open in a window").onClick(() => {
          new GuideModal(this.app, this.plugin).open();
        });
      });

    const guideEl = containerEl.createDiv({ cls: "oe-guide" });
    void renderUserGuide(this.app, guideEl, this.plugin);

    containerEl.createEl("h2", { text: "Settings" });

    const recoveryOn = this.plugin.isFileRecoveryEnabled();
    new Setting(containerEl)
      .setName("I know about File Recovery")
      .setDesc(
        recoveryOn
          ? "File Recovery is still on. It saves extra copies of notes that this plugin cannot hide. Turn it off, then tick this box."
          : "File Recovery is off, which is what we want. Tick this box if you have read the warning and do not want to be reminded.",
      )
      .addToggle((toggle) => {
        toggle.setValue(this.plugin.settings.fileRecoveryAcknowledged).onChange(async (value) => {
          this.plugin.settings.fileRecoveryAcknowledged = value;
          await this.plugin.saveSettings();
        });
      });

    new Setting(containerEl)
      .setName("Hide notes on disk")
      .setDesc(
        "When this is on, Markdown notes are scrambled as you save them. Turn it off only while you are trying to stop using the plugin. Notes that are already hidden can still be read inside Obsidian.",
      )
      .addToggle((toggle) => {
        toggle.setValue(this.plugin.settings.armed).onChange(async (value) => {
          this.plugin.settings.armed = value;
          await this.plugin.saveSettings();
          this.plugin.updateStatusBar();
        });
      });

    const keyId = this.plugin.settings.currentKeyId || "none yet";
    const keyCount = Object.keys(this.plugin.settings.keys).length;
    new Setting(containerEl)
      .setName("Current secret")
      .setDesc(
        `Notes are hidden with ${keyId}. You do not have to remember this name. The plugin currently keeps ${keyCount} secret(s), including older ones from a key change.`,
      );

    new Setting(containerEl)
      .setName("Hide leftover readable notes")
      .setDesc(
        "Use this if a Markdown file was added from outside Obsidian and still looks like a normal file on disk.",
      )
      .addButton((button) => {
        button.setButtonText("Hide them now").onClick(() => {
          void this.plugin.cloakRemaining({ notify: true });
        });
      });

    new Setting(containerEl)
      .setName("Change the secret")
      .setDesc(
        "Makes a new secret and rewrites every note. Do this on one computer, then wait for sync before opening the vault somewhere else.",
      )
      .addButton((button) => {
        button.setButtonText("Change secret").onClick(() => {
          new ConfirmModal(
            this.app,
            "This creates a new secret and rewrites every Markdown note. Use one computer only, and wait until sync finishes before opening the vault on another device.",
            () => {
              void this.plugin.rotateKey();
            },
            "Change secret",
          ).open();
        });
      });

    new Setting(containerEl)
      .setName("Forget unused secrets")
      .setDesc(
        "After a secret change has finished syncing, this throws away old secrets that no note still needs. Skip this if you are not sure.",
      )
      .addButton((button) => {
        button.setButtonText("Forget unused").onClick(() => {
          void this.plugin.retireUnusedKeys();
        });
      });

    new Setting(containerEl)
      .setName("Turn notes back into normal files")
      .setDesc(
        "Writes every note back as readable Markdown and stops hiding new saves. Cloud and antivirus scanners will be able to look at the contents again. Turn the plugin off afterwards if you want them to stay that way.",
      )
      .addButton((button) => {
        button.setButtonText("Restore readable files").setWarning().onClick(() => {
          new ConfirmModal(
            this.app,
            "This writes every note back as a normal file on disk. Cloud and antivirus scanners will be able to see the contents again.",
            () => {
              void this.plugin.decryptVault();
            },
            "Restore readable files",
          ).open();
        });
      });
  }
}
