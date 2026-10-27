export function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
    // XML에서 쓸 수 없는 제어 문자 지우기
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '');
}

/** 글 HTML 안의 /media/... 같은 상대 주소를 RSS 리더에서도 보이게 절대 주소로 바꿔요. */
export function absolutizeHtml(html: string, origin: string): string {
  return html.replace(/(src|href)="\/(?!\/)/g, `$1="${origin}/`);
}
