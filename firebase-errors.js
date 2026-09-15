export function mapFirebaseError(code) {
  const map = {
    'auth/email-already-in-use': 'Já existe uma conta com esse email.',
    'auth/invalid-email': 'Email inválido.',
    'auth/weak-password': 'Senha muito fraca (mínimo 6 caracteres).',
    'auth/user-not-found': 'Email ou senha inválidos.',
    'auth/wrong-password': 'Email ou senha inválidos.',
    'auth/invalid-credential': 'Email ou senha inválidos.',
    'auth/too-many-requests': 'Muitas tentativas. Aguarde um pouco e tente de novo.',
    'auth/network-request-failed': 'Sem conexão. Verifique sua internet.'
  };
  return map[code] || 'Algo deu errado. Confira se o Firebase do Oryon já foi configurado (veja README-DEPLOY.md).';
}
