// Which of the slower checks run. `npm test` leaves out the checks that read a local Saints Row install and builds each
// new-map-wizard setting and layout with one seed; `npm run test:game` adds the install checks, `npm run test:full`
// runs everything. vite.config.ts passes vitest's --mode on as SR1_TEST_MODE.
const mode = process.env.SR1_TEST_MODE

/** Every check, the whole wizard matrix included. */
export const FULL = mode === 'full'

/** The checks on a local game install (SR1_PACKFILES, or the default install folder), when there is one. */
export const GAME_TESTS = FULL || mode === 'game'
