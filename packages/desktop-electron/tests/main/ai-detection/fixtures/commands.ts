/**
 * Test fixtures for valid shell commands
 */

export const VALID_COMMANDS = {
  // Shell builtins
  builtins: [
    'cd /tmp',
    'cd ~',
    'cd ..',
    'echo "hello world"',
    'echo $HOME',
    'pwd',
    'export FOO=bar',
    'alias ll="ls -la"',
    'source ~/.bashrc',
  ],

  // Single word commands
  singleWord: [
    'ls',
    'pwd',
    'date',
    'whoami',
    'clear',
  ],

  // Git commands
  git: [
    'git status',
    'git add .',
    'git commit -m "fix bug"',
    'git push',
    'git pull',
    'git log --oneline',
    'git branch -a',
    'git checkout -b feature',
    'git merge main',
    'git stash pop',
    'git diff HEAD~1',
    'git clone https://github.com/foo/bar.git',
  ],

  // NPM commands
  npm: [
    'npm install',
    'npm install react',
    'npm install -D typescript',
    'npm run build',
    'npm run test',
    'npm start',
    'npm publish',
    'npm version patch',
    'npm outdated',
  ],

  // Docker commands
  docker: [
    'docker ps',
    'docker images',
    'docker run -it ubuntu',
    'docker build -t myapp .',
    'docker-compose up -d',
    'docker exec -it container bash',
    'docker logs -f container',
    'docker stop container',
  ],

  // Commands with flags
  withFlags: [
    'ls -la',
    'ls -lah',
    'grep -r "pattern" .',
    'find . -name "*.js"',
    'rm -rf node_modules',
    'cp -r src/ dest/',
    'chmod +x script.sh',
    'curl -s https://example.com',
  ],

  // Commands with paths
  withPaths: [
    'cat ./file.txt',
    'cat /etc/hosts',
    'cat ~/Documents/notes.txt',
    './script.sh',
    '/usr/bin/python3',
    '~/bin/custom-tool',
    'node src/index.js',
  ],

  // Pipelines
  pipelines: [
    'ls | grep foo',
    'cat file | head -10',
    'ps aux | grep node',
    'history | tail -20',
    'find . -name "*.ts" | xargs grep "TODO"',
    'curl -s url | jq ".data"',
  ],

  // Redirects
  redirects: [
    'echo hi > file.txt',
    'cat file >> output.txt',
    'cmd 2>&1',
    'cmd > /dev/null',
    'cmd < input.txt',
  ],

  // Variables and substitution
  variables: [
    'echo $HOME',
    'echo $PATH',
    'VAR=val npm start',
    'FOO=bar BAZ=qux command',
    'echo ${USER}',
    'echo $(date)',
    'echo `hostname`',
  ],

  // Complex commands
  complex: [
    'for i in *.txt; do echo $i; done',
    'if [ -f file ]; then cat file; fi',
    'npm install && npm run build',
    'git add . && git commit -m "msg"',
    'command1; command2; command3',
    'test -d dir && cd dir',
  ],
};

// Flatten all commands for easier iteration
export const ALL_VALID_COMMANDS = Object.values(VALID_COMMANDS).flat();
