// Pure: decide which roster rows can be created and why others are skipped.
export interface RosterRowIn { reporterId: string; firstName: string; lastName: string; indexNumber: number; pressPass: string }
export interface RosterPlan { toCreate: RosterRowIn[]; skipped: { reporterId: string; reason: string }[] }

export function planRosterImport(rows: readonly RosterRowIn[], existingReporterIds: ReadonlySet<string>, takenIndexNumbers: ReadonlySet<number>): RosterPlan {
  const seenIds = new Set<string>(), seenIdx = new Set<number>();
  const plan: RosterPlan = { toCreate: [], skipped: [] };
  for (const r of rows) {
    const id = r.reporterId.trim().toLowerCase();
    const skip = (reason: string) => plan.skipped.push({ reporterId: r.reporterId, reason });
    if (existingReporterIds.has(id)) skip("Reporter ID already exists");
    else if (takenIndexNumbers.has(r.indexNumber)) skip("Index number already used in this class");
    else if (seenIds.has(id)) skip("Duplicate reporter ID in this file");
    else if (seenIdx.has(r.indexNumber)) skip("Duplicate index number in this file");
    else { seenIds.add(id); seenIdx.add(r.indexNumber); plan.toCreate.push({ ...r, reporterId: id }); }
  }
  return plan;
}
