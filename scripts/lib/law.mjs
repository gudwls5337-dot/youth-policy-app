/**
 * 법제처 조례 원문 XML 을 받아 조문으로 쪼개는 공용 모듈.
 *
 * extract-governance.mjs 와 collect-yangsan-ordinances.mjs 가 같이 쓴다.
 * 각자 구현하면 **조문번호 6자리 함정**(`000902` = 제9조의2)이 한쪽에서만
 * 고쳐지고 다른 쪽은 조용히 가지번호를 잃는다. 그래서 여기 한 곳에만 둔다.
 */

const sleep = ms => new Promise(r => setTimeout(r, ms));

export const cdata = s => s.replace(/<!\[CDATA\[|\]\]>/g, "").trim();
export const pick = (xml, tag) => {
  const m = xml.match(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`));
  return m ? cdata(m[1]) : "";
};
/* 조례는 가운뎃점을 `·` 와 `ㆍ` 두 글자로 섞어 쓴다. 정규식이 한쪽만 보면 놓친다. */
export const flat = s => String(s || "").replace(/ㆍ/g, "·").replace(/\s+/g, " ").trim();

/** 조례 원문 XML. 실패하면 null (원칙 5 — 못 받은 것과 없는 것은 다르다). */
export async function fetchBody(mst) {
  for (let a = 1; a <= 3; a++) {
    try {
      const res = await fetch(`https://www.law.go.kr/DRF/lawService.do?OC=test&target=ordin&MST=${mst}&type=XML`,
        { signal: AbortSignal.timeout(30000) });
      const x = await res.text();
      if (!x.includes("<LawService>")) throw new Error("비정상 응답");
      return x;
    } catch { if (a === 3) return null; await sleep(900 * a); }
  }
}

/**
 * 조문 목록.
 * 조문번호는 6자리다: 앞 4자리 조번호 + 뒤 2자리 가지번호.
 * 철원군 `000902` = 제9조의2. 8자리로 가정하면 가지번호를 통째로 놓친다.
 * 조문번호를 인용하는 자료이므로 「제9조」와 「제9조의2」를 섞으면 안 된다.
 */
export function articles(xml) {
  return [...xml.matchAll(/<조\s[^>]*>([\s\S]*?)<\/조>/g)].map(([, b]) => ({
    no: pick(b, "조문번호"),
    title: pick(b, "조제목"),
    body: flat(pick(b, "조내용")),
  })).map(a => {
    const main = a.no ? parseInt(a.no.slice(0, 4), 10) : null;
    const sub = a.no && a.no.length >= 6 ? parseInt(a.no.slice(4, 6), 10) : 0;
    return { ...a, num: main, sub, label: main ? `제${main}조${sub ? `의${sub}` : ""}` : null };
  });
}
