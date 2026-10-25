import { internalArtifactTwirpClient } from './node_modules/@actions/artifact/lib/internal/shared/artifact-twirp-client.js';
import { getBackendIdsFromToken } from './node_modules/@actions/artifact/lib/internal/shared/util.js';
import { StringValue } from './node_modules/@actions/artifact/lib/generated/index.js';

const client = internalArtifactTwirpClient({maxAttempts: 1});
const backend = getBackendIdsFromToken();
const cases = [
  [8, '\u0085application/json'],
  [8, 'application/json\u0085'],
  [1337, '\u0085application/json'],
  [-1, '\u0085application/json'],
];
const results = [];

for (const [index, [version, mime]] of cases.entries()) {
  const name = `mime-version-${index}-${process.env.GITHUB_RUN_ID}`;
  try {
    const made = await client.CreateArtifact({
      ...backend,
      name,
      version,
      mimeType: StringValue.create({value: mime}),
    });
    results.push({version, codePoints: Array.from(mime, c => c.codePointAt(0)), ok: made.ok,
                  gotUploadUrl: Boolean(made.signedUploadUrl)});
  } catch (error) {
    results.push({version, codePoints: Array.from(mime, c => c.codePointAt(0)),
                  error: String(error?.message || error).replace(/[\r\n]+/g, ' ').slice(0, 260)});
  }
}

console.log('VERSION_BOUNDARY_RESULT', JSON.stringify(results));
