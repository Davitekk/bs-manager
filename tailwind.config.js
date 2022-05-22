const colors = require('tailwindcss/colors')

module.exports = {
  content: ['./src/renderer/**/*.tsx'],
  mode: 'jit',
  plugins: [require('tailwind-scrollbar-hide'), require('tailwind-scrollbar')],
  variants: {
    scrollbar: ['rounded']
  },
  theme:{
    colors:{
      ...colors,
      'main-color': {
        1: '#202225',
        2: '#2C2F33',
        3: '#40444b',
      },
    },
    extend:{
      keyframes:{
        zoominimg: {
          '0%, 100%': { scale: '100%' },
          '100%': { scale: '200%' }
        }
      },
    }
  }
};