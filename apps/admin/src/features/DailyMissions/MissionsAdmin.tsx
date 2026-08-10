import {useState} from "react"

import {ChestsEditor} from "./ChestsEditor"
import {MissionTypesEditor} from "./MissionTypesEditor"
import {RefreshMissionsTool} from "./RefreshMissionsTool"
import {RerollEditor} from "./RerollEditor"
import {SimulatorTab} from "./SimulatorTab"
import {StreakEditor} from "./StreakEditor"
import {TemplatesEditor} from "./TemplatesEditor"

/**
 * Daily Missions BO admin — Phase 7 per docs/specs/daily-missions.md.
 *
 * Tab shell that owns the sub-tab bar and renders one editor per tab, all
 * backed by RTK Query hooks:
 *   • Templates     — mission_templates CRUD + per-template reward bundle
 *   • Mission Types — mission_type_configs editor
 *   • Chests        — chest_milestones + chest_rewards bundles
 *   • Reroll        — reroll_pricing_config singleton (ladder + cap)
 *   • Streak Chest  — streak_chest_rewards bundle
 *   • Simulator     — sim test profiles, metric overrides, daily-mission
 *                     assignment runs, and cleanup
 * plus a Refresh Tool above the tab bar for on-demand refresh of a real
 * player's daily missions.
 *
 * Each editor lists rows in a table + opens a side draft pane on row
 * click. Supabase access is owned by the feature data layer
 * (DailyMissionsApi.ts / DailyMissionsData.ts); authoring writes remain
 * gated at the database level by RLS to private.can_manage_config (the
 * owner/admin role); non-admins see read-only views from the same client.
 */

type Props = {
  readonly canManage: boolean,
}

type SubTab = "templates" | "types" | "chests" | "reroll" | "streak" | "simulator"

export function MissionsAdmin({canManage}: Props) {
  const [tab, setTab] = useState<SubTab>("templates")

  const tabs: readonly {readonly id: SubTab, readonly label: string}[] = [{
    id: "templates",
    label: "Templates",
  }, {
    id: "types",
    label: "Mission Types",
  }, {
    id: "chests",
    label: "Chests",
  }, {
    id: "reroll",
    label: "Reroll",
  }, {
    id: "streak",
    label: "Streak Chest",
  }, {
    id: "simulator",
    label: "Simulator",
  }]

  return (<div className="space-y-4">
    {/* Sub-tab bar */}
    <div className="flex flex-wrap gap-1 rounded-lg bg-white/[0.04] p-1 ring-1 ring-white/10">
      {tabs.map((t) => (<button
        key={t.id}
        className={`rounded-md px-3 py-1.5 text-sm font-medium transition ${tab === t.id ? "bg-amber-500/20 text-amber-100 ring-1 ring-amber-400/40" : "text-white/70 hover:text-white"}`}
        type="button"
        onClick={() => {
          setTab(t.id)
        }}>
        {t.label}
      </button>))}
    </div>

    <RefreshMissionsTool canManage={canManage}/>

    {tab === "templates" && <TemplatesEditor canManage={canManage}/>}
    {tab === "types" && <MissionTypesEditor canManage={canManage}/>}
    {tab === "chests" && <ChestsEditor canManage={canManage}/>}
    {tab === "reroll" && <RerollEditor canManage={canManage}/>}
    {tab === "streak" && <StreakEditor canManage={canManage}/>}
    {tab === "simulator" && <SimulatorTab canManage={canManage}/>}
  </div>)
}
