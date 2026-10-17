import { AccountsPage } from './BrokersPage'

/** Sales agents: the same directory, accounts, and sales credit as Brokers. */
export default function SalesAgentsPage({ prefill, applicationId }) {
  return <AccountsPage kind="sales_agent" prefill={prefill} applicationId={applicationId} />
}
