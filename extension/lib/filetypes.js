/**
 * File type categories used by "File type" conditions and the {category}
 * destination variable. A file belongs to a category when its extension is
 * listed, or (as a fallback for extension-less files) when its MIME type
 * starts with one of the category's MIME prefixes.
 */
export const FILE_TYPES = [
  {
    id: 'documents',
    label: 'Documents',
    extensions: ['pdf', 'doc', 'docx', 'odt', 'rtf', 'txt', 'md', 'pages', 'epub', 'tex'],
    mimes: ['application/pdf', 'text/plain', 'application/msword'],
  },
  {
    id: 'spreadsheets',
    label: 'Spreadsheets',
    extensions: ['xls', 'xlsx', 'xlsm', 'ods', 'csv', 'tsv', 'numbers'],
    mimes: ['text/csv', 'application/vnd.ms-excel'],
  },
  {
    id: 'presentations',
    label: 'Presentations',
    extensions: ['ppt', 'pptx', 'odp', 'key'],
    mimes: ['application/vnd.ms-powerpoint'],
  },
  {
    id: 'images',
    label: 'Images',
    extensions: [
      'png',
      'jpg',
      'jpeg',
      'gif',
      'webp',
      'svg',
      'bmp',
      'tif',
      'tiff',
      'heic',
      'heif',
      'avif',
      'ico',
      'psd',
      'raw',
    ],
    mimes: ['image/'],
  },
  {
    id: 'video',
    label: 'Video',
    extensions: ['mp4', 'mov', 'mkv', 'webm', 'avi', 'm4v', 'wmv', 'flv', 'mpeg', 'mpg'],
    mimes: ['video/'],
  },
  {
    id: 'audio',
    label: 'Audio',
    extensions: ['mp3', 'wav', 'flac', 'aac', 'm4a', 'ogg', 'opus', 'aiff', 'wma'],
    mimes: ['audio/'],
  },
  {
    id: 'archives',
    label: 'Archives',
    extensions: ['zip', 'rar', '7z', 'tar', 'gz', 'tgz', 'bz2', 'xz', 'zst'],
    mimes: ['application/zip', 'application/x-7z-compressed', 'application/x-rar-compressed'],
  },
  {
    id: 'installers',
    label: 'Installers & apps',
    extensions: ['dmg', 'pkg', 'exe', 'msi', 'msix', 'deb', 'rpm', 'appimage', 'apk', 'crx'],
    mimes: ['application/x-apple-diskimage', 'application/x-msdownload'],
  },
  {
    id: 'code',
    label: 'Code & data',
    extensions: [
      'js',
      'mjs',
      'ts',
      'py',
      'ipynb',
      'json',
      'xml',
      'yaml',
      'yml',
      'toml',
      'html',
      'css',
      'sh',
      'sql',
      'java',
      'c',
      'cpp',
      'h',
      'go',
      'rs',
      'rb',
      'php',
    ],
    mimes: ['application/json', 'text/html'],
  },
  {
    id: 'fonts',
    label: 'Fonts',
    extensions: ['ttf', 'otf', 'woff', 'woff2'],
    mimes: ['font/'],
  },
];

const BY_ID = new Map(FILE_TYPES.map((type) => [type.id, type]));

/** Every extension that belongs to some category. */
export const KNOWN_EXTENSIONS = new Set(FILE_TYPES.flatMap((type) => type.extensions));

export function getFileType(id) {
  return BY_ID.get(id) ?? null;
}

/** Lower-case extension without the dot, or '' when there is none. */
export function extensionOf(filename) {
  const name = String(filename ?? '');
  const dot = name.lastIndexOf('.');
  if (dot <= 0 || dot === name.length - 1) return '';
  return name.slice(dot + 1).toLowerCase();
}

export function fileTypeMatches(id, filename, mime = '') {
  const type = BY_ID.get(id);
  if (!type) return false;
  const ext = extensionOf(filename);
  if (type.extensions.includes(ext)) return true;
  // A recognised extension is authoritative; only unknown or missing
  // extensions fall back to the MIME type.
  if (KNOWN_EXTENSIONS.has(ext)) return false;
  const m = String(mime).toLowerCase();
  return m !== '' && type.mimes.some((prefix) => m.startsWith(prefix));
}

/** The first category a file belongs to, or null. */
export function categorize(filename, mime = '') {
  return FILE_TYPES.find((type) => fileTypeMatches(type.id, filename, mime)) ?? null;
}
