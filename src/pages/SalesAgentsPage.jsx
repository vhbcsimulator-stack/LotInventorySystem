import { AccountsPage } from './BrokersPage'

/** Sales agents: the same directory, accounts, and sales credit as Brokers. */
export default function SalesAgentsPage() {
  return <AccountsPage kind="sales_agent" />
}
