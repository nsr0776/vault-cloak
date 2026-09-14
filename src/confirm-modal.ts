import { App, Modal, Setting } from "obsidian";

export class ConfirmModal extends Modal {
  private readonly message: string;
  private readonly confirmLabel: string;
  private readonly onConfirm: () => void;

  constructor(app: App, message: string, onConfirm: () => void, confirmLabel = "Continue") {
    super(app);
    this.message = message;
    this.onConfirm = onConfirm;
    this.confirmLabel = confirmLabel;
  }

  onOpen(): void {
    this.contentEl.createEl("p", { text: this.message });
    new Setting(this.contentEl)
      .addButton((button) => {
        button.setButtonText("Cancel").onClick(() => this.close());
      })
      .addButton((button) => {
        button
          .setButtonText(this.confirmLabel)
          .setWarning()
          .onClick(() => {
            this.close();
            this.onConfirm();
          });
      });
  }

  onClose(): void {
    this.contentEl.empty();
  }
}
