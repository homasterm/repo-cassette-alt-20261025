import { getBackendIdsFromToken } from './node_modules/@actions/artifact/lib/internal/shared/util.js';

const base = process.env.ACTIONS_RESULTS_URL;
const token = process.env.ACTIONS_RUNTIME_TOKEN;
const backend = getBackendIdsFromToken();

function varint(n) {
  const out = [];
  do {
    let b = n & 0x7f;
    n >>>= 7;
    if (n) b |= 0x80;
    out.push(b);
  } while (n);
  return Buffer.from(out);
}
function bytesField(number, bytes) {
  return Buffer.concat([varint((number << 3) | 2), varint(bytes.length), bytes]);
}
function stringField(number, text) {
  return bytesField(number, Buffer.from(text, 'utf8'));
}

const name = `invalid-utf8-${process.env.GITHUB_RUN_ID}`;
const invalidMime = Buffer.concat([Buffer.from([0x85]), Buffer.from('application/json')]);
const wrapper = bytesField(1, invalidMime);
const request = Buffer.concat([
  stringField(1, backend.workflowRunBackendId),
  stringField(2, backend.workflowJobRunBackendId),
  stringField(3, name),
  varint(5 << 3), varint(7),
  bytesField(6, wrapper),
]);

const url = new URL('/twirp/github.actions.results.api.v1.ArtifactService/CreateArtifact', base);
const response = await fetch(url, {
  method: 'POST',
  headers: {Authorization: `Bearer ${token}`, 'Content-Type': 'application/protobuf',
            'User-Agent': 'repo-cassette-invalid-utf8-probe'},
  body: request,
});
const body = Buffer.from(await response.arrayBuffer()).toString('utf8')
  .replace(/[\r\n]+/g, ' ').slice(0, 300);
console.log('INVALID_UTF8_RESULT', JSON.stringify({status: response.status, body}));
