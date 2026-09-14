# Vault Cloak

Scrambles the on-disk text of Markdown notes so cloud and antivirus scanners can't read them. Inside Obsidian, everything looks and behaves normally.

This is **not** a password vault. Anyone with the folder and the plugin can open the notes.

Only `.md` files are touched; images, PDFs, and other attachments are left alone. The key lives in the plugin's data under `.obsidian`, so it syncs with the vault if that folder is synced too.

## Install

Copy `main.js`, `manifest.json`, and `styles.css` into:

```
YourVault/.obsidian/plugins/vault-cloak/
```

Enable the plugin. Turn off File Recovery; it writes extra copies this plugin cannot hide. Install on every device that opens the vault.

## Build

```
npm install
npm test
npm run build
```

`npm run dev` rebuilds on save. Open `test-vault/` as a vault after building; keep real vaults under `local/` (gitignored).

## Commands

Open the command palette and type "Cloak" or "Encrypt".

- **Open user guide**: the in-plugin manual.
- **Cloak remaining plaintext notes**: hide leftover readable Markdown notes.
- **Cloak current note**: hide the open Markdown note.
- **Decrypt current note to disk**: restore one Markdown note to plaintext. If cloaking is on, saving the note, loading the plugin again, or **Cloak remaining plaintext notes** will hide it again.
- **Rotate encryption key**: re-encrypt all Markdown notes under a new key. Run on one device, then let it sync.
- **Retire unused encryption keys**: drop old keys after a rotation has synced everywhere.
- **Decrypt entire vault**: restore all Markdown notes to plaintext and stop cloaking new saves.

## Troubleshooting

- Notes look scrambled inside Obsidian: make sure the plugin is enabled on this device.
- A file is still readable on disk: run **Cloak remaining plaintext notes**.
- A second device can't open notes: install the plugin there and let `.obsidian` finish syncing.
- Some notes fail after rotating the key: wait for sync; don't retire old keys until every device has the new files.

## License

MIT
.