/**
 * The Chronicle logo in braille, 22 columns by 11 lines, so 44 by 44 dots,
 * drawn from the logo with the gaps between its discs widened so they stay
 * apart at this size.
 */
export const LOGO = [
  '                ⢤⡶⢶⣤⡀ ',
  '                ⢤⡄ ⠟⠁ ',
  '    ⢀⣠⣴⣶⠿⠿⠿⠿⠿⠷⣶⣤⣤⣤⣤⣴⡆ ',
  '  ⢠⣾⡿⠋⠁        ⢉⣿⣿⣿⣿⡇ ',
  ' ⢠⣿⣿⠁   ⣴⣿⣿⣿⣷⣶⣾⣿⣿⣿⣿⣿⡇ ',
  ' ⠘⣿⣿⡄   ⠙⠿⠿⠿⠟⠉⠙⠻⢿⣿⣿⣿⡇ ',
  ' ⢀⠈⠻⢿⣦⣄⣀     ⢀⣀⣤ ⢸⣿⣿⡇ ',
  '  ⠳⣤⣀⠉⠛⠛⠿⠿⠿⠿⠿⠟⠛⠉ ⢸⣿⣿⡇ ',
  ' ⠰⣄⠈⠛⠿⣶⣶⣤⣤⣤⣤⣤⣴⣶⠾ ⢸⣿⠟⠁ ',
  '  ⠈⠻⣦⣤⣀⣀⠉⠉⠉⠉⠉⢁⣀⣤ ⠈    ',
  '     ⠉⠛⠻⠿⠿⠿⠿⠿⠟⠛⠉      ',
];

/** The name, three lines high, in figlet's `future` font. */
export const WORDMARK = [
  '┏━╸╻ ╻┏━┓┏━┓┏┓╻╻┏━╸╻  ┏━╸',
  '┃  ┣━┫┣┳┛┃ ┃┃┗┫┃┃  ┃  ┣╸ ',
  '┗━╸╹ ╹╹┗╸┗━┛╹ ╹╹┗━╸┗━╸┗━╸',
];

/** The name, five lines high, in figlet's `slant` font. */
export const SLANT = [
  '   ________                     _      __',
  '  / ____/ /_  _________  ____  (_)____/ /__',
  ' / /   / __ \\/ ___/ __ \\/ __ \\/ / ___/ / _ \\',
  '/ /___/ / / / /  / /_/ / / / / / /__/ /  __/',
  '\\____/_/ /_/_/   \\____/_/ /_/_/\\___/_/\\___/',
];

/**
 * When the paper reaches each of the logo's dots as it unrolls, `0` to `z`
 * (0 to 1 in 36ths): first the curl at the top of the roll, then down the
 * column, then around the drum, disc by disc. `.` where there's no dot.
 */
const UNROLLED = [
  '............................................',
  '..................................0000......',
  '................................00000000....',
  '.................................00..0000...',
  '......................................000...',
  '......................................00....',
  '................................000...0.....',
  '.................................00.........',
  '................aaaaaa99999.................',
  '.............baaaaaaa9999999ml.........33...',
  '...........bbbaaaaaaa999999mllll444444444...',
  '.........bbbbbba............llll444444444...',
  '.......cbbbbb.................ll444444444...',
  '......ccccb.....................444444444...',
  '.....ccccc......................444444444...',
  '.....cccc......................k444444444...',
  '....ddccc.........a99llll....kkk555555555...',
  '....dddd.........a9llllkkkkkkkkk555555555...',
  '...ddddd........calkkkkkkkkkkkkk555555555...',
  '...ddddd........egijjjjjjjjjjjjj555555555...',
  '...eeeee........fghiiijjjjjjjjjj555555555...',
  '...eeeee.........ghhiiiijj...jjj555555555...',
  '....eeeee.........hhhiiii......j555555555...',
  '....eeeef........................66666666...',
  '.....effff.........................666666...',
  '......fffff........................666666...',
  '.......fffffg.................ii...666666...',
  '...k.....ffggggg...........iiiii...666666...',
  '....k.....gggggggghhhhhhhhhiiiii...666666...',
  '....ll......gggggghhhhhhhhhhii.....777777...',
  '.....lll........ggghhhhhhhh........777777...',
  '......llll.........................777777...',
  '.......llmmm...................p...777777...',
  '...q....mmmmmmmm...........ooooo...77777....',
  '...rr.....mmmmmmnnnnnnnooooooooo...7777.....',
  '....rr......mmmnnnnnnnnooooooo.....777......',
  '.....rrr........nnnnnnnnooo........8........',
  '......rrs...................................',
  '.......sssss..................vv............',
  '........sssssttt...........vvvvv............',
  '..........ssstttttttuuuuuuuuvvvv............',
  '............ttttttttuuuuuuuuuv..............',
  '...............tttttuuuuuuu.................',
  '............................................',
];

/** When the paper reaches a dot of the logo as it unrolls, from 0 to 1; undefined off the logo. */
export function unrolledAt(x: number, y: number): number | undefined {
  const at = UNROLLED[y]?.[x];
  return at === undefined || at === '.' ? undefined : Number.parseInt(at, 36) / 35;
}
