// 없는 페이지(4.3-5)
import { Layout, useTitle } from "../components/common.tsx";
import { NOT_FOUND_LABEL, NotFoundView } from "../components/notFoundView.ts";
import { Link, useLocation } from "../router.tsx";

/** 주소창처럼 한글을 풀어 보인다. 잘못된 인코딩이면 그대로 둔다 */
function readablePath(pathname: string): string {
  try {
    return decodeURI(pathname);
  } catch {
    return pathname;
  }
}

export function NotFoundPage() {
  useTitle(NOT_FOUND_LABEL);
  const { pathname } = useLocation();
  return (
    <Layout>
      <NotFoundView Link={Link} requested={readablePath(pathname)} />
    </Layout>
  );
}
