import fs from 'node:fs';
import path from 'node:path';

export function validateRuntimeBundleSources({ root, controllerSpecPath }) {
	const specPath = path.resolve(root, controllerSpecPath);
	const spec = JSON.parse(fs.readFileSync(specPath, 'utf8'));
	const failures = [];

	for (const workflow of spec.workflows || []) {
		const runtimeExecution = workflow.runtime_execution || {};
		if (runtimeExecution.kind !== 'bundle') {
			continue;
		}

		const source = runtimeExecution.input?.package?.source || '';
		if (!source) {
			failures.push(`${workflow.workflow_id}: runtime package source is required`);
			continue;
		}

		if (/^https?:\/\//i.test(source)) {
			continue;
		}

		const sourcePath = path.resolve(root, source);
		if (!fs.existsSync(sourcePath)) {
			failures.push(`${workflow.workflow_id}: runtime package source does not exist: ${source}`);
			continue;
		}

		const stat = fs.statSync(sourcePath);
		if (stat.isDirectory()) {
			const manifestPath = path.join(sourcePath, 'manifest.json');
			if (!fs.existsSync(manifestPath)) {
				failures.push(`${workflow.workflow_id}: runtime package directory must include manifest.json: ${source}`);
			}
			continue;
		}

		if (!/\.(json|zip)$/i.test(sourcePath)) {
			failures.push(`${workflow.workflow_id}: runtime package source must be a bundle directory, .json file, or .zip archive: ${source}`);
		}
	}

	if (failures.length > 0) {
		throw new Error(`Runtime bundle source preflight failed:\n- ${failures.join('\n- ')}`);
	}

	return { checked: true };
}
