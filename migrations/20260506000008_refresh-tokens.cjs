/* eslint-disable camelcase */

exports.up = (pgm) => {
  pgm.createTable('refresh_tokens', {
    jti: { type: 'text', primaryKey: true },
    user_id: {
      type: 'integer',
      notNull: true,
      references: 'users',
      onDelete: 'CASCADE',
    },
    expires_at: { type: 'timestamptz', notNull: true },
    revoked_at: { type: 'timestamptz' },
    user_agent: { type: 'text' },
    ip: { type: 'inet' },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });

  pgm.createIndex('refresh_tokens', 'user_id');
  pgm.createIndex('refresh_tokens', 'expires_at');
};

exports.down = (pgm) => {
  pgm.dropTable('refresh_tokens');
};
