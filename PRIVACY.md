# Privacy policy

Downshelf does not collect, transmit, sell or share any data.

- **No network access.** The extension makes no network requests and includes no analytics or
  third-party code.
- **Local storage only.** Your rules, settings and a short history of recently sorted downloads
  (file name, destination folder, site name and time, capped at 30 entries) are stored with
  `chrome.storage.local` on your device. You can clear the history from the settings page at any
  time; uninstalling the extension removes everything.
- **What the extension reads.** For each download, Chrome passes the extension the download URL,
  the referring page, the file name and the MIME type so that it can choose a folder. This
  information is processed locally and is not stored beyond the history described above.
- **Current tab.** When you open the toolbar popup, the `activeTab` permission lets Downshelf read
  the current tab's address to show rules for that site. It is not stored.

Questions: open an issue in the project repository.
