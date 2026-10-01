import { AuthenticatedRoleScreen } from '@/components/authenticated-role-screen';
import { ProfessionalNotificationsScreen } from '@/components/professional-notifications-screen';

export default function ProfessionalNotificationsRoute() {
  return (
    <AuthenticatedRoleScreen role="PROFESSIONAL">
      <ProfessionalNotificationsScreen />
    </AuthenticatedRoleScreen>
  );
}
