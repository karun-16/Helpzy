import { AuthenticatedRoleScreen } from '@/components/authenticated-role-screen';
import { ProfessionalReviewsScreen } from '@/components/professional-reviews-screen';

export default function ProfessionalReviewsRoute() {
  return (
    <AuthenticatedRoleScreen role="PROFESSIONAL">
      <ProfessionalReviewsScreen />
    </AuthenticatedRoleScreen>
  );
}
