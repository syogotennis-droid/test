// Next free employee ID (USER + number), shown on the 従業員を追加 screen (can be changed by hand).
//
// The last three digits mark the type the person was added as; when a range is full the
// next thousand is used (no upper limit):
//   アルバイト・パート  001–099  → 1001–1099 → 2001–2099 …
//   社員               101–199  → 1101–1199 …   (where 社員 start at 500: 501–699 → 1501–1699 …)
//   委託               201–999  → 1201–1999 …   (where 社員 start at 500: 701–999 → 1701–1999 …)
// A place's 社員 "start at 500" when its lowest 社員 number is 500 or more (e.g. あいち・千曲).
// The number after the highest one in use in that range, old IDs included, so a retired
// person's old QR card never matches a new person.
export function idRanges(users) {
  const salariedNums = (users || []).filter(u => u.employeeType === 'salaried')
    .map(u => /^USER(\d+)$/i.exec(u.id || '')).filter(Boolean).map(m => Number(m[1]) % 1000).filter(n => n >= 100)
  const from500 = salariedNums.length > 0 && Math.min(...salariedNums) >= 500
  return {
    hourly: [1, 99],
    salaried: from500 ? [501, 699] : [101, 199],
    contract: from500 ? [701, 999] : [201, 999],
  }
}

export function nextUserId(users, employeeType) {
  const [lo, hi] = idRanges(users)[employeeType] || idRanges(users).hourly
  const ids = (users || []).flatMap(u => [u.id, ...(u.formerIds || [])])
  const used = new Set(ids.map(id => String(id).toUpperCase()))
  const nums = ids.map(id => /^USER(\d+)$/i.exec(id || '')).filter(Boolean).map(m => Number(m[1]))
    .filter(n => n % 1000 >= lo && n % 1000 <= hi)
  let n = nums.length ? Math.max(...nums) + 1 : lo
  const fix = () => { if (n % 1000 > hi || n % 1000 < lo) n = (Math.floor(n / 1000) + (n % 1000 > hi ? 1 : 0)) * 1000 + lo }
  fix()
  while (used.has(`USER${String(n).padStart(3, '0')}`)) { n++; fix() }
  return `USER${String(n).padStart(3, '0')}`
}
