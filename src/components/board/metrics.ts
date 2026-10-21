/** The board is laid out in a fixed logical width and scaled to fit the screen. */
export const BOARD_WIDTH = 1000;
/** Logical width on phones, where everything stacks in one column. */
export const COMPACT_WIDTH = 580;
export const BOARD_PAD_X = 44;
export const BOARD_PAD_Y = 40;
export const COL_GAP = 36;
export const FULL_W = BOARD_WIDTH - BOARD_PAD_X * 2;
export const HALF_W = (FULL_W - COL_GAP) / 2;

export const cellWidth = (half: boolean) => (half ? HALF_W : FULL_W);
