import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const repoRoot = path.resolve(new URL('../..', import.meta.url).pathname);
const tempDir = await mkdtemp(path.join(tmpdir(), 'wpsg-static-site-candidate-validation-'));

try {
	const candidatePath = path.join(tempDir, 'StaticSiteCandidate.json');
	const settingsPath = path.join(tempDir, 'settings.json');
	await writeFile(candidatePath, JSON.stringify({
		schema_version: 'wp-site-generator/StaticSiteCandidate/v1',
		site_id: 'issue-777-direct-candidate',
		files: {
			'pages/home.html': '<!doctype html><html><body><main>Direct candidate</main></body></html>',
			'assets/styles.css': 'body { color: #111; }',
		},
	}, null, 2));

	const result = spawnSync(process.execPath, [
		'.github/scripts/build-static-validation-settings.mjs',
		'--candidate',
		candidatePath,
		'--output',
		settingsPath,
	], {
		cwd: repoRoot,
		encoding: 'utf8',
	});
	assert.equal(result.status, 0, result.stderr || result.stdout);

	const payload = JSON.parse(await readFile(settingsPath, 'utf8'));
	assert.equal(payload.site, 'issue-777-direct-candidate', 'validator derives the site slug from the candidate payload');
	assert.equal(payload.candidate_source.source, 'static-site-candidate-json', 'validator records direct candidate JSON provenance');
	assert.match(payload.candidate_source.relativeSourceDirectory, /^\.ci\/static-site-candidates\/issue-777-direct-candidate$/, 'candidate is materialized into a concrete static-site directory');
	assert.equal(payload.website_artifact.schema, 'blocks-engine/php-transformer/site-artifact/v1', 'validator converts candidate files to SSI-compatible Blocks Engine site artifact input');
	assert.deepEqual(payload.website_artifact.files.map((file) => file.path), ['website/assets/styles.css', 'website/pages/home.html'], 'website artifact contains candidate files under website/ without requiring index.html');
	assert.equal(payload.workloads[0].run[0].type, 'php', 'SSI workload probes transformer availability through PHP');
	assert.match(payload.workloads[0].run[0].code, /blocks_engine_php_transformer_compile_artifact|Automattic\\\\BlocksEngine\\\\PhpTransformer/, 'SSI workload probes Blocks Engine php-transformer helpers/classes');
	assert.equal(payload.workloads[0].run[1].type, 'php', 'SSI workload imports through the ability PHP bridge');
	assert.match(payload.workloads[0].run[1].code, /static-site-importer\/import-website-artifact/, 'SSI workload imports through the current website artifact ability');
	assert.match(payload.workloads[0].run[1].code, /blocks_engine_php_transformer_compile_artifact|Automattic\\\\BlocksEngine\\\\PhpTransformer/, 'SSI import path requires Blocks Engine php-transformer helpers/classes');
	assert.doesNotMatch(payload.workloads[0].run[1].code, /static-site-importer\/import-theme/, 'SSI workload does not depend on the legacy import-theme ability');
	assert.equal(
		await readFile(path.join(repoRoot, payload.candidate_source.relativeSourceDirectory, 'pages/home.html'), 'utf8'),
		'<!doctype html><html><body><main>Direct candidate</main></body></html>',
		'materialized candidate payload preserves file contents'
	);

	const materializedDir = path.join(tempDir, 'direct-static-site');
	const materializedSettingsPath = path.join(tempDir, 'materialized-settings.json');
	await mkdir(path.join(materializedDir, 'assets'), { recursive: true });
	await writeFile(path.join(materializedDir, 'index.html'), '<!doctype html><html><body>Already materialized</body></html>');
	await writeFile(path.join(materializedDir, 'assets/styles.css'), 'body { margin: 0; }');
	const materializedResult = spawnSync(process.execPath, [
		'.github/scripts/build-static-validation-settings.mjs',
		'--source-static-site-dir',
		materializedDir,
		'--output',
		materializedSettingsPath,
	], {
		cwd: repoRoot,
		encoding: 'utf8',
	});
	assert.equal(materializedResult.status, 0, materializedResult.stderr || materializedResult.stdout);
	const materializedPayload = JSON.parse(await readFile(materializedSettingsPath, 'utf8'));
	assert.equal(materializedPayload.site, 'direct-static-site', 'validator derives the site slug from a materialized artifact directory');
	assert.equal(materializedPayload.candidate_source.source, 'source-static-site-dir', 'validator records materialized directory provenance');
	assert.equal(materializedPayload.website_artifact.schema, 'blocks-engine/php-transformer/site-artifact/v1', 'materialized directory is converted to SSI-compatible Blocks Engine site artifact input');
	assert.equal(materializedPayload.workloads[0].run[1].type, 'php', 'materialized directory imports through the ability PHP bridge');
	assert.match(materializedPayload.workloads[0].run[1].code, /static-site-importer\/import-website-artifact/, 'SSI workload imports provided directory through website artifact ability');

	const unresolvedResult = spawnSync(process.execPath, ['.github/scripts/build-static-validation-settings.mjs'], {
		cwd: repoRoot,
		encoding: 'utf8',
		env: {
			...process.env,
			STATIC_SITE_CANDIDATE_PATH: '{{outputs.static_site_candidate}}',
		},
	});
	assert.notEqual(unresolvedResult.status, 0, 'validator fails before running when orchestrator placeholders are unresolved');
	assert.match(unresolvedResult.stderr, /STATIC_SITE_CANDIDATE_PATH was not resolved before validation/, 'failure names the unresolved StaticSiteCandidate input');
} finally {
	await rm(path.join(repoRoot, '.ci/static-site-candidates/issue-777-direct-candidate'), { recursive: true, force: true });
	await rm(path.join(repoRoot, '.ci/static-site-candidates/direct-static-site'), { recursive: true, force: true });
	await rm(tempDir, { recursive: true, force: true });
}

console.log('static site candidate validation harness passed');
