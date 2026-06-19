// Bespoke render-time population for 3k_dlc07_ambition_panel (the Liu Yan
// "Aspiration" panel). The panel's task / trade-off lists are empty in the
// static XML: at runtime a Lua script (dlc07_faction_liu_yan_resource_manager)
// clones a single template row per entry and fills its icon/title from the
// `ambition_panel_data_pack`. We reproduce that here so the viewer shows the
// real content instead of a blank panel.
//
// Data transcribed from the script's data pack + the in-game screenshot
// (there is no localisation table on disk for these UI strings). Icons live
// under ui/skins/default/ and were verified to exist on disk.

import { RawElement, TwuiDocument } from "../types/twui";
import { elementChildren, guidOf, hierarchyRoot } from "./doc";

/** The panel id this injection targets (the root's single child component). */
export const AMBITION_PANEL_ID = "3k_dlc07_ambition_panel";

const SKIN = "ui/skins/default/";

export interface AmbitionTask {
  /** Mission icon (left of the row). */
  icon: string;
  /** Loc record key for the title (resolved from campaign_localised_strings). */
  titleKey: string;
  /** Fallback title if the loc string isn't loaded. */
  title: string;
  /** The reward this task unlocks (icon shown at the right of the row). */
  rewardIcon: string;
}

// task key -> mission icon, title loc key, and the reward_key it unlocks
// (script mission_list); reward_key -> reward icon comes from reward_list.
// Fallback titles transcribed from the screenshot; the real strings come from
// the loc table (e.g. "Stern Defence & Cutting Attack", "Lethal Duellist").
export const AMBITION_TASKS: AmbitionTask[] = [
  { icon: SKIN + "3k_dlc07_ambition_mission_lethal_duelist.png", titleKey: "3k_dlc07_liu_yan_ambition_task_win_duels_title", title: "Lethal Duelist", rewardIcon: SKIN + "3k_dlc07_ambition_bonus_recruitement_posters.png" },
  { icon: SKIN + "3k_dlc07_ambition_mission_stern_defense_and_cutting_attack.png", titleKey: "3k_dlc07_liu_yan_ambition_task_full_stack_armies_title", title: "Stern Defence & Cutting Attack", rewardIcon: SKIN + "3k_dlc07_ambition_bonus_industrial_restructuring.png" },
  { icon: SKIN + "3k_dlc07_ambition_mission_flowing_gold.png", titleKey: "3k_dlc07_liu_yan_ambition_task_high_income_title", title: "Flowing Gold", rewardIcon: SKIN + "3k_dlc07_ambition_bonus_economic_stimulus.png" },
  { icon: SKIN + "3k_dlc07_ambition_mission_experienced_general.png", titleKey: "3k_dlc07_liu_yan_ambition_task_lead_battles_title", title: "Experienced General", rewardIcon: SKIN + "3k_dlc07_ambition_bonus_private_tutelage.png" },
  { icon: SKIN + "3k_dlc07_ambition_mission_swelling_domain.png", titleKey: "3k_dlc07_liu_yan_ambition_task_own_regions_title", title: "Swelling Domain", rewardIcon: SKIN + "3k_dlc07_ambition_bonus_soldier_drills.png" },
  { icon: SKIN + "3k_dlc07_ambition_mission_worldwide_contacts.png", titleKey: "3k_dlc07_liu_yan_ambition_task_know_factions_title", title: "Worldwide Contacts", rewardIcon: SKIN + "3k_dlc07_ambition_bonus_artisan_commisions.png" },
  { icon: SKIN + "3k_dlc07_ambition_mission_trained_and_wise.png", titleKey: "3k_dlc07_liu_yan_ambition_task_reach_level_title", title: "Trained & Wise", rewardIcon: SKIN + "3k_dlc07_ambition_bonus_investment_in_education.png" },
  { icon: SKIN + "3k_dlc07_ambition_mission_the_shining_capital.png", titleKey: "3k_dlc07_liu_yan_ambition_task_developed_town_title", title: "The Shining Capital", rewardIcon: SKIN + "3k_dlc07_ambition_bonus_construction_stimulus.png" },
];

/** Resolve a task's display title from the loc map, falling back to the transcription. */
export function taskTitle(task: AmbitionTask, loc?: Record<string, string>): string {
  return loc?.[task.titleKey] ?? task.title;
}

// Trade-off toggles (script tradeoff_list icon_path). Shown as a horizontal
// row of icons; the game shows no title under them.
export const AMBITION_TRADEOFFS: { icon: string }[] = [
  { icon: SKIN + "3k_dlc07_trade_off_market_protectionism.png" },
  { icon: SKIN + "3k_dlc07_trade_off_loyalty_ispections.png" },
  { icon: SKIN + "3k_dlc07_trade_off_public_checkpoints.png" },
  { icon: SKIN + "3k_dlc07_trade_off_military_surplus_to_market.png" },
  { icon: SKIN + "3k_dlc07_trade_off_divert_to_coffers.png" },
  { icon: SKIN + "3k_dlc07_trade_off_construction_inspectors.png" },
  { icon: SKIN + "3k_dlc07_trade_off_raised_court_standards.png" },
  { icon: SKIN + "3k_dlc07_trade_off_smith_education.png" },
];

/** First hierarchy node (DFS) whose tag matches; returns its GUID. */
export function guidByTag(root: RawElement, tag: string): string | undefined {
  const stack: RawElement[] = [root];
  while (stack.length) {
    const n = stack.pop()!;
    if (n.tag === tag) return guidOf(n);
    for (const c of elementChildren(n)) stack.push(c);
  }
  return undefined;
}

/** True when the loaded document is the Liu Yan ambition panel. */
export function isAmbitionPanel(doc: TwuiDocument): boolean {
  const root = hierarchyRoot(doc);
  if (!root) return false;
  // The root hierarchy node's single child is the panel component.
  return elementChildren(root).some((c) => c.tag === "_3k_dlc07_ambition_panel");
}

export interface AmbitionGuids {
  tabPre?: string;
  tabPost?: string;
  templateMission?: string;
  templateTradeOff?: string;
  listClip?: string;
  tradeOffsHolder?: string;
}

/** Resolve the GUIDs the injection needs from the hierarchy (by unique tag). */
export function ambitionGuids(doc: TwuiDocument): AmbitionGuids {
  const root = hierarchyRoot(doc);
  if (!root) return {};
  return {
    tabPre: guidByTag(root, "tab_pre"),
    tabPost: guidByTag(root, "tab_post"),
    templateMission: guidByTag(root, "template_mission"),
    templateTradeOff: guidByTag(root, "template_trade_off"),
    listClip: guidByTag(root, "list_clip"),
    tradeOffsHolder: guidByTag(root, "trade_offs_holder"),
  };
}
