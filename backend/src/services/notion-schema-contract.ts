export const DATA_BASES = [
  'Hunter Stats','Hunter Ranks','Hunter Classes','Hunters','Weeks','Habits',
  'Habit Days','Habit Completions','Daily Quests','Mission Objectives','Mission History',
] as const;
export type LogicalDatabase = typeof DATA_BASES[number];

// Type-level contracts avoid imposing property labels on user-owned templates.
export const REQUIRED_TYPES: Record<LogicalDatabase, string[]> = {
  'Hunter Stats': ['title','number'], 'Hunter Ranks': ['title','number'], 'Hunter Classes': ['title','rich_text'],
  'Hunters': ['title','number','relation'], 'Weeks': ['title','date','relation'],
  'Habits': ['title','number','relation'], 'Habit Days': ['title','date','relation'],
  'Habit Completions': ['title','checkbox','relation'], 'Daily Quests': ['title','date','number','relation'],
  'Mission Objectives': ['title','number','relation'], 'Mission History': ['title','date','relation'],
};
export const REQUIRED_RELATIONS: Partial<Record<LogicalDatabase, LogicalDatabase[]>> = {
  'Hunters': ['Hunter Ranks','Hunter Classes'], 'Weeks': ['Hunters'],
  'Habits': ['Hunters','Hunter Stats'], 'Habit Days': ['Weeks'],
  'Habit Completions': ['Habit Days','Habits'], 'Daily Quests': ['Hunters'],
  'Mission Objectives': ['Daily Quests'], 'Mission History': ['Daily Quests','Hunters'],
};
