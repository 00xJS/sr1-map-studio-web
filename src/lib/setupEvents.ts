// The event a remembered folder's change sends (sr1char/folder.ts, install.ts), so the Connect page and its prompts
// read it again (setup.ts). Its own module so those files don't load the setup store.
export const SETUP_CHANGED = 'sr1-setup-changed'
