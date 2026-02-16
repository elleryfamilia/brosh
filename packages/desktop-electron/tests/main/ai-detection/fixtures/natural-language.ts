/**
 * Test fixtures for natural language inputs
 */

export const NATURAL_LANGUAGE = {
  // Questions starting with question words
  questions: [
    'how do I list files?',
    'what is the current directory?',
    'why is my build failing?',
    'where are the config files?',
    'when was this file modified?',
    'who has access to this repo?',
    'which version of node?',
    'can you help me?',
    'could you explain this?',
    'would you run the tests?',
    'should I commit now?',
  ],

  // Requests starting with polite words
  requests: [
    'please show me the logs',
    'help me find the bug',
    'explain how this works',
    'describe the architecture',
    'tell me about the API',
    'show me how to deploy',
    'list all the dependencies',
    'find the authentication code',
  ],

  // Command-like words but clearly NL
  commandLikeButNL: [
    'git how do I revert a commit?',
    'git is giving me errors',
    'ls beginning to look like christmas',
    'cat is sleeping on the keyboard',
    'npm is not working properly',
    'docker what are the best practices?',
    'find the meaning of life',
    'grep why is it not finding anything?',
    'make it work please',
    'curl up in bed',
  ],

  // Conversational responses
  conversational: [
    'yes',
    'no',
    'ok',
    'okay',
    'sure',
    'thanks',
    'thank you',
    'sorry',
    'hi',
    'hello',
    'hey',
    'great',
    'good',
    'nice',
    'cool',
    'awesome',
    'perfect',
    'fine',
    'right',
    'yeah',
    'yep',
    'nope',
    'maybe',
    'probably',
    'definitely',
    'absolutely',
  ],

  // Sentences that start with "I"
  firstPerson: [
    'I want to deploy this',
    'I need help with testing',
    'I am trying to understand this',
    'I have a question about the API',
    'I think there is a bug here',
  ],

  // Multi-word NL without command features
  multiWord: [
    'the build is broken',
    'this code is confusing',
    'my tests are failing',
    'a simple example would help',
    'an error occurred during startup',
    'not sure what to do next',
  ],

  // Ends with question mark
  endsWithQuestion: [
    'is this correct?',
    'does this look right?',
    'what?',
    'why?',
    'how?',
    'can you?',
  ],

  // Ends with period (more NL-like)
  endsWithPeriod: [
    'I need help.',
    'Something is wrong.',
    'This is not working.',
    'Please explain.',
  ],

  // Contractions - should NOT be detected as commands
  contractions: [
    "i'm testing this",
    "don't do that",
    "what's the weather",
    "it's working now",
    "I've been trying",
    "they're all here",
    "we'll see about that",
    "can't find the file",
    "won't work properly",
    "isn't this correct",
    "aren't you coming",
    "user's profile",
    "the system's config",
  ],
};

// Flatten all NL inputs for easier iteration
export const ALL_NATURAL_LANGUAGE = Object.values(NATURAL_LANGUAGE).flat();
