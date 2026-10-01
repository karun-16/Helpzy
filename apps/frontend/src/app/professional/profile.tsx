import { AuthenticatedRoleScreen } from '@/components/authenticated-role-screen';
import { ProfessionalProfileScreen } from '@/components/professional-profile-screen';

export default function ProfessionalProfileRoute() {
  return (
    <AuthenticatedRoleScreen role="PROFESSIONAL">
      <ProfessionalProfileScreen />
    </AuthenticatedRoleScreen>
  );
}
