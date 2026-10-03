import { AuthenticatedRoleScreen } from '@/components/authenticated-role-screen';
import { AccountSettingsScreen } from '@/components/account-settings-screen';

export default function ProfessionalSettingsRoute() {
  return (
    <AuthenticatedRoleScreen role="PROFESSIONAL">
      <AccountSettingsScreen role="PROFESSIONAL" />
    </AuthenticatedRoleScreen>
  );
}
