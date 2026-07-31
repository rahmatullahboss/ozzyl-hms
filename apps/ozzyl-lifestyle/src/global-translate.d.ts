declare global {
  var t: (key: string, options?: { defaultValue?: string; [key: string]: unknown }) => string;
}

export {};
