export default {
  table: 'dependencies',
  fields: ['from_app_id', 'to_app_id', 'description'],
  required: ['from_app_id', 'to_app_id'],
  check: (b) => (Number(b.from_app_id) === Number(b.to_app_id) ? "une application ne peut pas dépendre d'elle-même" : null),
};
