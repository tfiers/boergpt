// Een nagemaakte Netlify Blobs-opslag voor de tests: set, get, delete en list, in het geheugen.
// Elke bewerking wacht één tik, zoals de echte, zodat gelijktijdige verzoeken door elkaar lopen.
export const nepStore = () => {
  const m = new Map();
  return {
    set: async (k, v) => { await null; m.set(k, v); },
    setJSON: async (k, v) => { await null; m.set(k, v); },
    get: async k => { await null; return m.get(k) ?? null; },
    delete: async k => { await null; m.delete(k); },
    list: async ({ prefix = "" } = {}) => { await null; return { blobs: [...m.keys()].filter(k => k.startsWith(prefix)).map(key => ({ key })) }; },
  };
};
