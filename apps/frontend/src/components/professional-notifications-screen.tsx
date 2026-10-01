import { NotificationInbox } from '@/components/notification-inbox';

/**
 * The professional's notification history.
 *
 * Professionals were previously given no inbox at all, even though the API writes
 * notifications for them on booking events and verification decisions. This is
 * the same inbox the customer uses, pointed at the professional's own booking
 * screens, so a notification opens the job it refers to.
 */
export function ProfessionalNotificationsScreen() {
  return (
    <NotificationInbox
      role="PROFESSIONAL"
      homeRoute="/professional"
      bookingRoutePrefix="/professional/bookings"
      emptyDetail="Booking requests, job updates and verification decisions will appear here once something happens."
    />
  );
}
