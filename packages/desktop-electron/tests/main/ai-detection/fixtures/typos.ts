/**
 * Test fixtures for typo detection
 */

export interface CommandTypo {
  typo: string;
  correct: string;
  fullInput?: string;
  fullCorrected?: string;
}

export interface SubcommandTypo {
  command: string;
  typo: string;
  correct: string;
  fullInput?: string;
  fullCorrected?: string;
}

// Command typos (first word)
export const COMMAND_TYPOS: CommandTypo[] = [
  // Transposition typos
  { typo: 'gti', correct: 'git', fullInput: 'gti status', fullCorrected: 'git status' },
  { typo: 'nmp', correct: 'npm', fullInput: 'nmp install', fullCorrected: 'npm install' },
  { typo: 'dcoker', correct: 'docker', fullInput: 'dcoker ps', fullCorrected: 'docker ps' },
  { typo: 'kubeclt', correct: 'kubectl', fullInput: 'kubeclt get pods', fullCorrected: 'kubectl get pods' },

  // Missing character
  { typo: 'gi', correct: 'git', fullInput: 'gi status', fullCorrected: 'git status' },
  { typo: 'np', correct: 'npm', fullInput: 'np install', fullCorrected: 'npm install' },

  // Extra character
  { typo: 'gitt', correct: 'git', fullInput: 'gitt status', fullCorrected: 'git status' },
  { typo: 'nppm', correct: 'npm', fullInput: 'nppm install', fullCorrected: 'npm install' },

  // Substitution
  { typo: 'got', correct: 'git', fullInput: 'got status', fullCorrected: 'git status' },
  { typo: 'npa', correct: 'npm', fullInput: 'npa install', fullCorrected: 'npm install' },

  // Common misspellings
  { typo: 'yarm', correct: 'yarn', fullInput: 'yarm add react', fullCorrected: 'yarn add react' },
  { typo: 'cargi', correct: 'cargo', fullInput: 'cargi build', fullCorrected: 'cargo build' },
  { typo: 'bew', correct: 'brew', fullInput: 'bew install node', fullCorrected: 'brew install node' },
];

// Subcommand typos (second word for commands with subcommands)
export const SUBCOMMAND_TYPOS: SubcommandTypo[] = [
  // Git subcommands
  { command: 'git', typo: 'comit', correct: 'commit', fullInput: 'git comit -m "msg"', fullCorrected: 'git commit -m "msg"' },
  { command: 'git', typo: 'stauts', correct: 'status', fullInput: 'git stauts', fullCorrected: 'git status' },
  { command: 'git', typo: 'psuh', correct: 'push', fullInput: 'git psuh', fullCorrected: 'git push' },
  { command: 'git', typo: 'pul', correct: 'pull', fullInput: 'git pul', fullCorrected: 'git pull' },
  { command: 'git', typo: 'brnach', correct: 'branch', fullInput: 'git brnach', fullCorrected: 'git branch' },
  { command: 'git', typo: 'checkou', correct: 'checkout', fullInput: 'git checkou main', fullCorrected: 'git checkout main' },
  { command: 'git', typo: 'merg', correct: 'merge', fullInput: 'git merg main', fullCorrected: 'git merge main' },

  // NPM subcommands
  { command: 'npm', typo: 'instal', correct: 'install', fullInput: 'npm instal react', fullCorrected: 'npm install react' },
  { command: 'npm', typo: 'uninsatll', correct: 'uninstall', fullInput: 'npm uninsatll lodash', fullCorrected: 'npm uninstall lodash' },
  { command: 'npm', typo: 'publsih', correct: 'publish', fullInput: 'npm publsih', fullCorrected: 'npm publish' },

  // Docker subcommands
  { command: 'docker', typo: 'buld', correct: 'build', fullInput: 'docker buld .', fullCorrected: 'docker build .' },
  { command: 'docker', typo: 'imags', correct: 'images', fullInput: 'docker imags', fullCorrected: 'docker images' },
  { command: 'docker', typo: 'exce', correct: 'exec', fullInput: 'docker exce -it container bash', fullCorrected: 'docker exec -it container bash' },

  // Yarn subcommands
  { command: 'yarn', typo: 'ad', correct: 'add', fullInput: 'yarn ad react', fullCorrected: 'yarn add react' },
  { command: 'yarn', typo: 'remov', correct: 'remove', fullInput: 'yarn remov lodash', fullCorrected: 'yarn remove lodash' },

  // Cargo subcommands
  { command: 'cargo', typo: 'biuld', correct: 'build', fullInput: 'cargo biuld', fullCorrected: 'cargo build' },
  { command: 'cargo', typo: 'tets', correct: 'test', fullInput: 'cargo tets', fullCorrected: 'cargo test' },
];

// Words that should NOT be treated as typos (NL starter words)
export const NL_NOT_TYPOS = [
  // Question words
  'how', 'what', 'why', 'where', 'when', 'who', 'which', 'whose',
  // Modal verbs
  'can', 'could', 'would', 'should', 'will', 'shall', 'may', 'might', 'must',
  // Be verbs
  'is', 'are', 'was', 'were', 'am', 'be', 'been', 'being',
  // Other verbs
  'do', 'does', 'did', 'have', 'has', 'had',
  // Pronouns
  'i', 'you', 'he', 'she', 'it', 'we', 'they',
  // Possessives
  'my', 'your', 'his', 'her', 'its', 'our', 'their',
  // Demonstratives
  'this', 'that', 'these', 'those',
  // Request words
  'please', 'help', 'show', 'tell', 'explain', 'describe', 'list', 'find', 'search',
  // Articles
  'the', 'a', 'an',
  // Conversational
  'yes', 'no', 'ok', 'okay', 'sure', 'thanks', 'thank', 'sorry', 'hi', 'hello',
  'hey', 'great', 'good', 'nice', 'cool', 'awesome', 'perfect', 'fine', 'right',
  'yeah', 'yep', 'nope', 'maybe', 'probably', 'definitely', 'absolutely',
];

// Inputs that look like typos but are actually NL
export const NL_LOOKS_LIKE_TYPO = [
  'how far is the moon',
  'what time is it',
  'why is the sky blue',
  'can you help me',
  'i need assistance',
  'yes please',
  'no thanks',
  'ok let me try',
  'sure go ahead',
  'thanks for helping',
];

// Inputs that are clearly too far from any command to be typos
export const NOT_TYPOS_TOO_FAR = [
  'foobar something',
  'asdfgh',
  'qwerty',
  'xyz123',
  'supercalifragilistic',
];
