// 없는 페이지(4.3-5)
import { Layout, useTitle } from "../components/common.tsx";
import { Link } from "../router.tsx";

export function NotFoundPage() {
  useTitle("없는 페이지");
  return (
    <Layout>
      <div className="plain">
        <h1 className="page-title">없는 페이지</h1>
        <p className="p">주소에 맞는 페이지가 없다. 저장되지 않은 날짜이거나 없는 이슈·인물·기관·국가·용어·일정일 수 있다.</p>
        <p className="p">
          <Link to="/" className="text-link">
            첫 화면으로 가기
          </Link>
        </p>
      </div>
    </Layout>
  );
}
