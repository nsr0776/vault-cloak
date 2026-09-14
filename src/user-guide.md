Scrambles Markdown notes on disk so cloud and antivirus scanners can't read them. Inside Obsidian they look and behave as usual.

This is not a password vault. Anyone with the folder and the plugin can open the notes. Only `.md` files are touched. The key lives in the plugin data under `.obsidian`; it follows the vault only if that folder is synced too.

## What you should see

- In Obsidian: normal notes. The status bar may say **Cloaked**; click it for settings.
- On disk, outside Obsidian: a line starting with `vault-cloak`, then scrambled text. That is expected.
- Images, PDFs, other attachments, and everything in `.obsidian` are left alone.

## Use

1. Enable the plugin. It will rewrite existing Markdown notes on disk.
2. Keep editing as usual. Saves hide notes; opens show the real text.
3. A `.md` file added to the vault from outside Obsidian is hidden shortly afterwards.
4. Install the plugin on every device that opens this vault.
5. Turn **File Recovery** off. Its extra copies are not hidden.

If the editor shows scrambled text, make sure the plugin is enabled.

## Commands

Command palette: type "Cloak".

- **Cloak remaining plaintext notes**: hide leftover readable Markdown notes.
- **Cloak current note**: hide the open Markdown note.
- **Decrypt current note to disk**: restore one Markdown note to plaintext. If cloaking is on, saving the note, loading the plugin again, or **Cloak remaining plaintext notes** will hide it again.
- **Rotate encryption key**: re-encrypt all Markdown notes under a new key. Run on one device, wait for sync, then open the vault elsewhere. Do not run this on two devices at once.
- **Retire unused encryption keys**: drop old keys after a rotation has synced everywhere.
- **Decrypt entire vault**: restore all Markdown notes to plaintext and stop cloaking new saves.

To stop using the plugin: run **Decrypt entire vault**, then disable it. If you only disable it, files stay scrambled on disk.

## Troubleshooting

- Still readable on disk: run **Cloak remaining plaintext notes**. Check it is a `.md` note, not an attachment, and that File Recovery is off.
- Another device can't open notes: install the plugin there and let `.obsidian` finish syncing.
- Notes fail after rotating the key: wait for sync. Do not retire old keys until every device has the new files.
