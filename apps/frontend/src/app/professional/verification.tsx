import { AuthenticatedRoleScreen } from '@/components/authenticated-role-screen';
import { ProfessionalVerificationScreen } from '@/components/professional-verification-screen';

export default function ProfessionalVerificationRoute() {
  return (
    <AuthenticatedRoleScreen role="PROFESSIONAL">
      <ProfessionalVerificationScreen />
    </AuthenticatedRoleScreen>
  );
}
