import { MarketplaceHeader } from '@/components/marketplace-ui';

/**
 * Compatibility shim for the existing customer screens.
 *
 * The customer header used to be a second, independent implementation with its
 * own unread-count fetch, its own initials logic and a hardcoded "Customer" role
 * label - which is why the photo and name could not appear in it. It now
 * delegates to the single shared `MarketplaceHeader`, so every customer screen
 * gets the real avatar, the real unread count, the account menu, dark mode and
 * live session updates.
 *
 * `customerName` is intentionally unused: the shared header reads the name from
 * the live session, which is the point of this change. It stays in the signature
 * so the screens that pass it do not all need editing at once.
 */
export function CustomerMarketplaceHeader({
  onHomePress,
  onLogout,
  guest = false,
}: {
  customerName: string;
  onHomePress: () => void;
  onLogout?: () => void;
  guest?: boolean;
}) {
  return (
    <MarketplaceHeader
      homeRoute={guest ? '/' : '/customer'}
      onHome={onHomePress}
      onSignOut={onLogout}
    />
  );
}
