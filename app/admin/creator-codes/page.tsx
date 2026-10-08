import { GiftIcon } from "@/components/icons";
import { PageHeader } from "@/components/page-header";
import { StatTile } from "@/components/stat-tile";
import { requireAdmin } from "@/lib/auth/session";
import { discountLabel, displayCode, statsFrom } from "@/lib/creator-codes/codes";
import { siteOrigin } from "@/lib/referrals/links";
import { getServices } from "@/lib/services";
import { CreateCodeForm } from "./create-form";
import { markPaidOut, setCodeActive, setCodeDiscount } from "./actions";

export const dynamic = "force-dynamic";

const dollars = (cents: number) => `$${(cents / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export default async function AdminCreatorCodesPage() {
  await requireAdmin();
  const repo = getServices().repositories.creatorCodes;
  const codes = await repo.list();
  const commissions = await repo.commissions(codes.map((c) => c.id));
  const origin = await siteOrigin();
  const rows = codes.map((code) => ({ code, stats: statsFrom(commissions.filter((c) => c.code_id === code.id)) }));
  const totals = statsFrom(commissions);

  return (
    <div className="stack">
      <PageHeader
        icon={GiftIcon}
        title="Creator codes"
        subtitle="Creators share outlier/?code=NAME. Their viewers get money off a paid plan, and the creator earns a cut of what those viewers pay. You pay commissions out yourself, then mark them paid here."
      />

      <div className="grid grid-4">
        <StatTile label="Paying customers" value={totals.customers.toLocaleString()} note="Paid at least once with a code" />
        <StatTile label="Revenue" value={dollars(totals.revenueCents)} note="Before tax" />
        <StatTile label="Commission earned" value={dollars(totals.earnedCents)} />
        <StatTile label="Owed now" value={dollars(totals.owedCents)} note="Not marked paid out yet" />
      </div>

      <section className="card">
        <h2 className="section-title">New code</h2>
        <p className="stat-note">
          The discount comes off the full plan price (Pro $15), not the launch price. You can change it later: new checkouts get the new discount, and people already
          subscribed keep theirs.
        </p>
        <CreateCodeForm />
      </section>

      <section className="card">
        {rows.length === 0 ? (
          <div className="empty">No creator codes yet.</div>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Code</th>
                  <th>Creator</th>
                  <th>Viewer gets</th>
                  <th>Creator gets</th>
                  <th>Customers</th>
                  <th>Revenue</th>
                  <th>Earned</th>
                  <th>Owed</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {rows.map(({ code, stats }) => (
                  <tr key={code.id}>
                    <td>
                      <strong>{displayCode(code.code)}</strong>
                      {code.active ? null : <span className="stat-note"> (off)</span>}
                      <div className="stat-note">{`${origin}/?code=${displayCode(code.code)}`}</div>
                    </td>
                    <td>{code.creator_name}</td>
                    <td>
                      {discountLabel(code)}
                      <details className="code-discount-edit">
                        <summary className="stat-note">Change</summary>
                        <form action={setCodeDiscount} className="row" style={{ gap: 6, marginTop: 6 }}>
                          <input type="hidden" name="id" value={code.id} />
                          <input name="discountPercent" type="number" min={1} max={100} defaultValue={code.discount_percent} aria-label="Discount %" style={{ width: 64 }} />
                          <span className="stat-note">% for</span>
                          <input name="discountMonths" type="number" min={1} max={36} defaultValue={code.discount_months} aria-label="Months" style={{ width: 56 }} />
                          <span className="stat-note">mo</span>
                          <button type="submit" className="button-ghost">
                            Save
                          </button>
                        </form>
                      </details>
                    </td>
                    <td>
                      {code.commission_percent}%{code.commission_months ? ` for ${code.commission_months} mo` : ", ongoing"}
                    </td>
                    <td>{stats.customers}</td>
                    <td>{dollars(stats.revenueCents)}</td>
                    <td>{dollars(stats.earnedCents)}</td>
                    <td>{dollars(stats.owedCents)}</td>
                    <td>
                      <div className="row" style={{ gap: 8 }}>
                        {stats.owedCents > 0 ? (
                          <form action={markPaidOut}>
                            <input type="hidden" name="id" value={code.id} />
                            <button type="submit" className="button-ghost">
                              Mark {dollars(stats.owedCents)} paid
                            </button>
                          </form>
                        ) : null}
                        <form action={setCodeActive}>
                          <input type="hidden" name="id" value={code.id} />
                          <input type="hidden" name="active" value={code.active ? "0" : "1"} />
                          <button type="submit" className="button-ghost">
                            {code.active ? "Turn off" : "Turn on"}
                          </button>
                        </form>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
