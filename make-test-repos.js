const NO_CHANGE={status: 1, message: "No changes to add"}

const tests=[
{ graph: String.raw`
        3-4
           \
      1-2-D-5-I-J-6-K
         /     /
    a-c-d-e-g-h
     /     /
    b     f
`, workbranch: "K", remote: "h"},
{ graph: `
1-2-3-B-5
     /
  a-b`, workbranch: "5", remote: "b"},
{ graph: `
1-2-3-B-5-C
     /
  a-b`, workbranch: "5", remote: "b"},
{ graph: `
1-A
 /
a`, workbranch: "A", remote: "a"},
{graph: String.raw`
5-6-7
     \
  1-B-2-G-H-4-I
   /     /
a-b--c--e-f`, workbranch: "I", remote: "f"},
]

const id = /[a-zA-Z0-9]/
function searchBackwardsForParent(line, start) {
   while (line[start] === '-') {
      start--
   }
   if (id.test(line[start])) {
     return line[start]
   } else {
     return undefined
   }
}

function parse(data) {
   const lines = data.graph.split("\n");
   const result = data.parsed = {}
   for (let l = 0; l < lines.length; l++) {
      const line = lines[l];
      for (let c = 0; c < line.length; c++) {
        const char = line[c];
        if (id.test(char)) {
          result[char] = [];
          const prevParent = searchBackwardsForParent(line, c - 1)
          if (prevParent !== undefined) {
            result[char].push(prevParent)
          }
          if (lines[l - 1] !== undefined && lines[l-1][c-1] === "\\") {
              result[char].push(lines[l-2][c-2])
          }
          if (lines[l + 1] !== undefined && lines[l+1][c-1] === "/") {
              result[char].push(lines[l+2][c-2])
          }
        }
      }
   }
   return data;
}

function sortTree(data) {
   const keys = Object.keys(data.parsed)
   const result = data.sorted = []
   const usedKeys = {};
   while (keys.length > 0) {
     for (let i = 0; i < keys.length; i++) {
       if (data.parsed[keys[i]].every(parent => usedKeys[parent])) {
         usedKeys[keys[i]] = true;
         result.push({key: keys[i], parents: data.parsed[keys[i]]})
         keys.splice(i, 1)
         break;
       }
     }
   }
   return data;
}
const spawn = require("child_process").spawn;

function initCmd(dir) {
  return function run(cmd, args, stdin) {
    // console.debug(`running: ${cmd} ${args.map(x => JSON.stringify(x)).join(" ")} < ${JSON.stringify(stdin)}`)
    return new Promise(function (resolve, reject) {
      const child = spawn(cmd, args, {cwd: dir});
      var resp = "";
      var errtxt = "";
      child.stdout.on('data', b => resp += b.toString())
      child.stderr.on('data', b => errtxt += b.toString())
      child.once('exit', (code, signal) => {
        // console.debug("result:  " + JSON.stringify(resp.trim()))
        if (code === 0) {
          return resolve(resp.trim());
        } else {
          reject({dir, code, stdout: resp, stderr: errtxt, cmd: [cmd].concat(args), stdin})
        }
      })
      child.once('error', (err) => reject({error: err}));
      if (stdin !== undefined) {
        child.stdin.setEncoding('utf-8')
        child.stdin.write(stdin);
        child.stdin.end();
      }
    })
  }
}

async function construct(parsed, dirname) {
  const cmd = initCmd(dirname);
  const git = cmd.bind(null, "git")
  
  async function makeTreeWithOneFile(filename, contents) {
    const obj = await git(["hash-object", "-w", "--stdin"], contents);
    return git(["mktree"], `100644 blob ${obj}\t${filename}\n`)
  }

  function commit(tree, parents, message) {
    return git(["commit-tree", tree, "-m", message].concat(
      parents.length === 0 
        ? [] 
        : parents.map(p => ["-p", p]).reduce((p,c) => p.concat(c), [])
    ))
  }

  await git(["init", "."])
  const commits = {};
  let head = undefined;
  for (const item of parsed.sorted) {
    // commits with a lowercase letter get that letter in a file called libdata in the project root
    if (/[a-z]/.test(item.key)) {
      const tree = await makeTreeWithOneFile("libdata", item.key)
      head = await commit(tree, item.parents.map(p => commits[p]), item.key)
      commits[item.key] = head     
    // commits with a number get that number in a file called rootdata in the project root
    } else if (!isNaN(+item.key)) {
      const tree = await makeTreeWithOneFile("rootdata", item.key)
      head = await commit(tree, item.parents.map(p => commits[p]), item.key)
      commits[item.key] = head     
    // commits with an uppercase letter get the lowercase version of that data in a folder called "sub"
    } else {
      const subtree = await makeTreeWithOneFile("libdata", item.key.toLowerCase());
      const tree = await git(["mktree"], `040000 tree ${subtree}\tsubdir\n`)
      head = await commit(tree, item.parents.map(p => commits[p]), item.key)
      commits[item.key] =head      
    }
    await git(["branch", "-f", "commit" + item.key, head])
  }
  await git(["branch", "-f", "master", commits[parsed.workbranch]])
  await git(["branch", "-f", "remote", commits[parsed.remote]])
}

async function run() {
  const cmd = initCmd(".");
  await cmd("rm", ["-rf", "./test"])
  for (let i = 0; i < tests.length; i++) {
    const dirname = "./test/test" + i
    await cmd("mkdir", ["-p", dirname])
    await construct(sortTree(parse(tests[i])), dirname)
  }
}

run().catch(function (err) { console.log("ERROR: ", err)})
