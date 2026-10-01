import { NotificationInbox } from '@/components/notification-inbox';

/**
 * The customer's notification history.
 *
 * The inbox itself is shared with professionals in `NotificationInbox`; only the
 * role guard, the home route and the booking a notification opens differ.
 */
export function CustomerNotificationsScreen() {
  return (
    <NotificationInbox
      role="CUSTOMER"
      homeRoute="/customer"
      bookingRoutePrefix="/customer/bookings"
      emptyDetail="Updates about your bookings, payments and reviews will appear here once something happens."
    />
  );
}
