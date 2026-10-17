import { AccountsPage } from './BrokersPage'

/** Regular users: app logins made and removed like brokers', with no sales credit. */
export default function RegularUsersPage({ prefill, applicationId }) {
  return <AccountsPage kind="regular_user" prefill={prefill} applicationId={applicationId} />
}
