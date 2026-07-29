import { printSetupTokenIfEmpty } from '../utils/setupToken'

// On boot, if no admin exists, log the one-time setup token + instructions so
// the operator can create the first account from `docker compose logs admin`.
export default defineNitroPlugin(() => {
  printSetupTokenIfEmpty()
})
