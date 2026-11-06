// 7단계 개인정보 처리방침(V6, V16, 4.7-4). 본문은 components/policyView.ts가 그린다
import { BriefBackLink, Layout, useTitle } from "../components/common.tsx";
import { PrivacyView } from "../components/policyView.ts";
import { PRIVACY_TITLE } from "../lib/policy.ts";
import { Link } from "../router.tsx";

export function PrivacyPage() {
  useTitle(PRIVACY_TITLE);
  return (
    <Layout left={<BriefBackLink />}>
      <article className="plain">
        <PrivacyView Link={Link} />
      </article>
    </Layout>
  );
}
