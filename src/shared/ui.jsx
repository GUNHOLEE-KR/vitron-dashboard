// 대시보드와 포털이 함께 쓰는 «껍데기».
// 여기서 만들지 않고 각자 만들면 두 화면의 카드 모양이 조금씩 갈린다.

// 카드 한 장. 제목은 없어도 된다(그냥 흰 상자로 쓸 때가 있다).
export function Card({ title, children, style = {} }) {
  return <div style={{
    background: '#fff', border: '1px solid #e5e7eb', borderRadius: 10,
    padding: 18, marginBottom: 16, ...style,
  }}>
    {title && <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 14 }}>{title}</div>}
    {children}
  </div>
}
