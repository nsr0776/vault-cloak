import { App, MarkdownRenderer, Modal, type Component } from "obsidian";
import userGuide from "./user-guide.md";

export const USER_GUIDE_MARKDOWN = userGuide;

export async function renderUserGuide(
  app: App,
  containerEl: HTMLElement,
  component: Component,
): Promise<void> {
  containerEl.empty();
  containerEl.addClass("oe-guide");
  await MarkdownRenderer.render(app, USER_GUIDE_MARKDOWN, containerEl, "", component);
}

export class GuideModal extends Modal {
  private readonly owner: Component;

  constructor(app: App, owner: Component) {
    super(app);
    this.owner = owner;
  }

  onOpen(): void {
    this.modalEl.addClass("oe-guide-modal");
    this.setTitle("Vault Cloak user guide");
    const body = this.contentEl.createDiv({ cls: "oe-guide-body" });
    void renderUserGuide(this.app, body, this.owner);
  }

  onClose(): void {
    this.contentEl.empty();
  }
}
