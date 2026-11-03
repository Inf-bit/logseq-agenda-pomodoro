export function todayStr(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** YYYYMMDD 数字形态（Datalog :block/journal-day 查询用） */
export function todayNum(): number {
  return Number(todayStr().replace(/-/g, ''))
}
